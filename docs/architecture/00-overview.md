# 00 — System Overview & Folder Structure

## 1. What SAGE Is

A personal AI operating system with five pillars sitting on one shared substrate:

```
┌────────────────────────────────────────────────────────────────┐
│  SHELL (Next.js app)                                           │
│  Command Palette · Chat · Workspace · Dashboard · Voice        │
├────────────────────────────────────────────────────────────────┤
│  ORCHESTRATOR (LangGraph)                                      │
│  Router → Planner → Specialist Agents → Reviewer → Responder   │
├──────────────┬──────────────┬──────────────┬───────────────────┤
│ MEMORY       │ KNOWLEDGE    │ TOOLS        │ AUTOMATION        │
│ engine       │ base (RAG)   │ registry     │ scheduler         │
│ (pgvector)   │ (ingestion)  │ (MCP-shaped) │ (cron/workflows)  │
├──────────────┴──────────────┴──────────────┴───────────────────┤
│  INFRASTRUCTURE                                                │
│  Postgres+pgvector (Supabase) · Prisma · Queue · Storage       │
│  Claude API · OpenAI (embeddings/STT/TTS) · Tavily/Exa/Firecrawl │
└────────────────────────────────────────────────────────────────┘
```

Key architectural bets:

- **One brain, many faces.** Chat, palette, voice, and dashboard are all thin views over the same orchestrator + memory. No feature owns intelligence.
- **Everything is an event.** User messages, agent steps, ingestion jobs, automations — all append to an event log. Memory extraction, dashboards, and audit read from it.
- **Tools are MCP-shaped from day one.** Every tool implements `{name, description, inputSchema (JSON Schema), execute}` — exactly the MCP tool contract. Adding real MCP servers later means adding one adapter, not refactoring.
- **Local-first feel, server-first truth.** React Query + optimistic updates + streaming make the UI feel native; Postgres is the single source of truth.

## 2. Tech Stack (confirmed)

| Layer | Choice | Notes |
| --- | --- | --- |
| Framework | Next.js 15 (App Router) + TypeScript strict | RSC for reads, route handlers for mutations/streams |
| Styling | Tailwind + shadcn/ui + Framer Motion | Custom pure-black theme tokens |
| Data | Supabase Postgres + pgvector, Prisma | One DB for relational + vectors — no separate vector DB at MVP |
| AI | Vercel AI SDK (streaming) + LangGraph (orchestration) + Claude API (reasoning) + OpenAI (embeddings, Whisper, TTS) | AI SDK for the wire, LangGraph for the graph |
| Search/Ingest | Tavily (search), Exa (semantic search), Firecrawl (scrape) | Behind a `SearchProvider` interface — swappable |
| Client state | Zustand (UI state) + React Query (server state) | Strict separation, see doc 05 |
| Editors | Tiptap (notes), Monaco (code), React Flow (whiteboard/workflows), TanStack Table, Recharts | Lazy-loaded |
| Jobs | Supabase cron + `pg-boss` queue (Postgres-backed) | No Redis at MVP; swap to BullMQ/Redis at scale |
| Desktop | Electron (Phase 4) | Shell wraps the same Next.js app; voice + global hotkey are the desktop win |

## 3. Folder Structure (feature-based)

```
sage/
├── app/                          # Next.js App Router — routes only, zero logic
│   ├── (auth)/login/ signup/
│   ├── (shell)/                  # Authenticated shell: sidebar + palette + layout
│   │   ├── page.tsx              # Dashboard (Morning Brief)
│   │   ├── chat/[[...threadId]]/
│   │   ├── workspace/[projectId]/
│   │   ├── knowledge/
│   │   ├── automations/
│   │   ├── memory/               # Memory browser ("what do you know about me")
│   │   └── settings/
│   └── api/
│       ├── chat/route.ts         # Streaming orchestrator endpoint
│       ├── voice/route.ts        # STT/TTS + realtime
│       ├── ingest/route.ts       # Knowledge ingestion
│       ├── cron/route.ts         # Scheduler tick (secured)
│       └── trpc/[trpc]/route.ts  # Typed CRUD API (tRPC)
│
├── features/                     # Vertical slices — UI + hooks + feature logic
│   ├── chat/          {components/, hooks/, store.ts, types.ts}
│   ├── command-palette/
│   ├── dashboard/
│   ├── workspace/     # projects, notes (Tiptap), whiteboard (React Flow), journal
│   ├── knowledge/     # sources, ingestion UI, document viewer
│   ├── memory/        # memory browser + editing
│   ├── automations/   # workflow builder, reminders, scheduled tasks
│   ├── voice/         # wake word, VAD, streaming audio
│   └── settings/
│
├── core/                         # Domain layer — pure TS, no React, no I/O
│   ├── agents/                   # Agent definitions & orchestration graphs
│   │   ├── orchestrator/         # LangGraph master graph (router→plan→act→review)
│   │   ├── registry.ts           # AgentRegistry — agents self-register
│   │   └── {planner,research,coder,reviewer,writer,finance,learning,health,automation}/
│   ├── tools/                    # MCP-shaped tool registry
│   │   ├── registry.ts  types.ts # ToolDefinition = MCP tool contract
│   │   ├── native/               # web-search, scrape, memory, calendar, email…
│   │   └── mcp/                  # MCP client adapter (Phase 3+)
│   ├── memory/                   # Memory engine (doc 03)
│   │   ├── extraction.ts recall.ts consolidation.ts working-memory.ts
│   ├── knowledge/                # Ingestion pipelines: pdf, url, youtube, github, docs
│   ├── automation/               # Scheduler, workflow engine, triggers
│   └── shared/                   # Result type, errors, event bus, ids, zod schemas
│
├── infrastructure/               # I/O implementations behind core interfaces
│   ├── db/                       # Prisma client, repositories
│   ├── llm/                      # Claude/OpenAI providers behind LLMProvider
│   ├── embeddings/  search/      # OpenAI embeddings; Tavily/Exa/Firecrawl providers
│   ├── storage/  queue/  auth/   # Supabase storage, pg-boss, Supabase auth
│   └── integrations/             # google-calendar, gmail, github (OAuth clients)
│
├── components/ui/                # shadcn primitives + motion primitives (design system)
├── lib/                          # framework glue: trpc setup, utils, config, constants
├── prisma/schema.prisma
├── styles/
└── tests/ {unit,integration,e2e}
```

**Dependency rule (enforced with ESLint boundaries):**
`app → features → core ← infrastructure`. `core` imports nothing from the other three; `infrastructure` implements `core` interfaces; `features` may use `core` + call APIs, never `infrastructure` directly. This is what makes every feature independently replaceable.

## 4. Naming

Display name lives in `lib/config.ts` (`APP_NAME`). SAGE vs AXIOM is a one-line change.
