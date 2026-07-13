# 04 — Agent Architecture

LangGraph for orchestration, Vercel AI SDK for the streaming wire, Claude for reasoning. One master graph; specialist agents are subgraphs registered in a registry.

## 1. The Orchestrator Graph

```
            ┌─────────┐
 user msg → │ CONTEXT │  assemble working memory (doc 03)
            └────┬────┘
            ┌────▼────┐   fast model (Haiku) classifies:
            │ ROUTER  │   chat | task | question — and which agent(s)
            └────┬────┘
     simple ┌────┴─────────────┐ complex
            ▼                  ▼
      ┌──────────┐       ┌──────────┐
      │ RESPOND  │       │ PLANNER  │ goal → ordered steps (streamed to UI)
      │ (direct, │       └────┬─────┘
      │ streamed)│       ┌────▼─────┐
      └──────────┘       │ EXECUTOR │ per step: pick agent/tool, run,
                         │  (loop)  │ update plan state, replan on failure
                         └────┬─────┘
                         ┌────▼─────┐
                         │ REVIEWER │ checks output vs goal; ≤2 retry loops
                         └────┬─────┘
                         ┌────▼─────┐
                         │ RESPOND  │ synthesize, stream, suggest follow-ups
                         └──────────┘
```

- **Checkpointing:** LangGraph Postgres checkpointer keyed by `AgentRun.id` — runs survive restarts, are pausable/cancellable, and every node transition writes an `AgentStep` (full observability, replayable).
- **Human-in-the-loop:** any tool marked `requiresApproval` (email send, file delete, command execution, purchases) interrupts the graph, streams a `data-approval` part, and resumes on user confirm. Approval policies configurable per tool ("always ask" / "ask once per session" / "auto").
- **Budgets:** each run carries `{maxSteps: 20, maxCostUsd, maxWallClock}`; breach → graceful stop with partial results.

## 2. Agent Registry

```ts
interface AgentDefinition {
  name: string;                // "research"
  description: string;         // used BY THE ROUTER to route — quality matters
  systemPrompt: (ctx: WorkingMemory) => string;
  tools: string[];             // tool names from ToolRegistry
  model: ModelTier;            // "fast" | "smart" | "reasoning" (mapped in infra)
  subgraph?: StateGraph;       // custom flow; default = ReAct loop
  requiresApproval?: string[]; // tool names needing HITL for this agent
}
```

Agents self-register at boot (`core/agents/*/index.ts`). Adding an agent = one folder + registration; the router picks it up from its description. No orchestrator changes.

| Agent | Model tier | Key tools | Notes |
| --- | --- | --- | --- |
| Planner | reasoning | none (pure) | decomposition + replanning |
| Research | smart | web_search (Tavily/Exa), scrape (Firecrawl), knowledge_search | citation-required output schema |
| Coder | smart | repo_read, code_search, file_write*, run_command* | *approval-gated |
| Reviewer | smart | none | rubric scoring vs goal |
| Writer | smart | knowledge_search, memory_search | style learned from memory |
| Finance | smart | market_data, web_search | tracks holdings from memory; read-only |
| Learning | fast | knowledge_search, task_create | study plans → tasks/reminders |
| Health | fast | memory (opt-in scope), reminder_create | strictly opt-in data |
| Automation | fast | all automation tools | builds/edits workflow DAGs |

## 3. Tool Layer — MCP-shaped from day one

```ts
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;            // exactly MCP's contract
  execute(input, ctx: ToolContext): Promise<ToolResult>;
  requiresApproval?: boolean;
  scopes?: string[];                  // integration scopes needed
}
```

`ToolRegistry` holds native tools (memory_search, memory_write, knowledge_search, web_search, scrape, calendar_*, email_draft, task_*, reminder_*, note_*, run_command…). Because the contract *is* the MCP tool contract:

- **Phase 3 MCP client:** `McpToolProvider` connects to configured MCP servers (GitHub, Slack, Notion, Drive, Spotify, Terminal, Browser, VS Code, Filesystem…), lists their tools, and registers them into the same registry namespaced `mcp:{server}:{tool}`. Agents and the approval system treat them identically. Zero refactor.
- **Phase 4 MCP server:** SAGE exposes its own memory/knowledge/tasks as an MCP server so external clients (Claude Code, IDEs) can use SAGE as their memory.

`ToolContext` carries `{userId, runId, abortSignal, integrationTokens, emit(streamPart)}` — tools stream progress to the UI themselves.

## 4. Model Strategy

| Tier | Model | Used for |
| --- | --- | --- |
| fast | Claude Haiku | routing, extraction, titles, simple agents |
| smart | Claude Sonnet | default agent work, chat |
| reasoning | Claude Opus/Fable | planning, hard coding, review of critical output |

Mapped in `infrastructure/llm/models.ts` only. Embeddings: OpenAI `text-embedding-3-small` (1536d). STT: Whisper. TTS: OpenAI TTS (MVP) → realtime voice later.

## 5. Proactivity

Proactive behaviors are **automations that invoke agents**, not a separate system: morning brief = cron → orchestrator with a fixed goal; "flight tomorrow, no hotel booked" = nightly reflection job that scans calendar+memory and creates suggestion cards (never acts without approval).
