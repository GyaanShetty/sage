# 07 — Roadmap, Risks, Performance, Expansion

## 1. Roadmap: MVP → Production

Each phase ships something usable daily. No phase starts until the previous one is *actually used* — real usage is the spec for the next phase.

### Phase 0 — Foundation (week 1–2)
Repo scaffolding, CI (typecheck/lint/test/build), Prisma schema + migrations + RLS, Supabase auth flow, design system (theme tokens, motion primitives, GlassPanel, shell layout, sidebar, empty command palette), tRPC skeleton.
**Exit:** log in, see the empty shell, ⌘K opens.

### Phase 1 — MVP: Chat + Memory (week 3–6) ← the product bet
Streaming chat (orchestrator = router+respond only), memory extraction/recall/browser, thread management, command palette with navigation + `/ask`, working morning-brief-lite (static cards: tasks, threads).
**Exit:** daily-driver chat that *provably remembers you across sessions*. If memory doesn't feel magical here, fix it before adding anything.

### Phase 2 — Knowledge + Workspace (week 7–10)
Ingestion pipelines (PDF, URL, YouTube, GitHub), hybrid RAG with citations, projects/notes (Tiptap)/tasks/journal, project-scoped chat context, palette actions `/summarize`, `/create project`.

### Phase 3 — Agents + Automation (week 11–16)
Full orchestrator graph (planner/executor/reviewer), Research + Coder + Writer agents with run inspector UI, approval flow, scheduler + reminders + morning brief (real: calendar/email/GitHub via OAuth integrations), workflow builder, **MCP client adapter** (GitHub + filesystem servers first).

### Phase 4 — Voice + Desktop + Polish (week 17–22)
Voice (push-to-talk → wake word, streaming STT/TTS, barge-in), Electron shell (global hotkey, tray, local notifications, sandboxed command runner), remaining agents (Finance, Learning, Health, Automation), motion polish pass, performance pass, security review.

### Production hardening (ongoing from Phase 3)
Error tracking (Sentry), tracing on agent runs (Langfuse/OTel), cost dashboards, backup/restore drills, load tests on chat + ingestion, pen-test of tool approval paths.

## 2. Risks & Mitigations

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| **Scope collapse** — 9 agents + voice + desktop is 3 products | High | Phasing above; Phase 1 memory-chat is the only bet that matters early |
| Memory quality poor (wrong/creepy/noisy) | Med-High | Confidence gates, supersession, browser with forget; tune extraction on real transcripts weekly |
| LLM cost blowout | Med | Model tiers, budgets per run, prompt caching (Claude), nightly cost report card in dashboard |
| Prompt injection → unwanted actions | Med | Capability firewall + taint tracking (doc 06) — designed-in, not bolted on |
| Provider/API churn (models, MCP spec) | Med | Everything behind `core` ports; MCP contract already the tool contract |
| Latency kills the "alive" feel | Med | Streaming-first everywhere, fast-model routing, perceived-perf patterns below |
| Vendor lock (Supabase) | Low | Prisma + standard Postgres; auth/storage behind interfaces |
| Solo-builder burnout | High | Each phase is independently shippable and useful |

## 3. Performance Plan

- **Perceived speed first:** stream everything; optimistic UI on all CRUD; skeletons within 100ms; palette results < 50ms (client-side fuzzy over prefetched index).
- **LLM latency:** router on Haiku (<400ms), speculative "thinking" UI starts on submit, Claude prompt caching for system prompt + working memory prefix, parallel tool calls in the executor.
- **DB:** HNSW indexes; filtered ANN (userId) to keep recall <30ms; cursor pagination; `Message.content` fetched windowed; connection pooling (Supabase pooler / Prisma Accelerate).
- **Bundle:** heavy editors dynamically imported; RSC for all read views; target <180KB first-load JS on shell routes; `next/font` self-hosted.
- **Jobs:** embeddings batched (100/req); ingestion parallel per-chunk with backpressure; consolidation off-peak.
- **Budgets in CI:** Lighthouse + bundle-size checks fail the build.

## 4. Future Expansion

1. **MCP server mode** — SAGE's memory/knowledge/tasks exposed as an MCP server: your memory follows you into Claude Code, IDEs, other clients. This is the long-term platform play.
2. **Integrations wave 2** — Slack, Discord, Notion, Drive, Spotify, Browser, VS Code via MCP client (no new architecture needed).
3. **Realtime voice** — speech-to-speech models for true conversational latency; wake word on-device (Porcupine) in Electron.
4. **Mobile** — React Native or PWA reading the same API; voice + brief + capture only.
5. **Multi-user / teams** — schema already userId-scoped; add orgs, shared projects, shared knowledge with per-source ACLs.
6. **Local models** — Ollama behind `LLMProvider` for private/offline tiers (extraction and routing first).
7. **Proactive engine v2** — reflection jobs that learn routines and propose automations ("you do this every Monday — want me to?").
8. **Plugin SDK** — third-party agents/tools via the same registries, sandboxed.
