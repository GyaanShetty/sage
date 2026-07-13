# 02 — API Design

Two API surfaces, deliberately split:

1. **tRPC** — typed CRUD for everything that isn't AI (threads, notes, tasks, sources, automations, settings). End-to-end types, React Query integration for free.
2. **Route handlers** — anything streaming or webhook-shaped (chat, voice, ingestion progress, cron ticks). tRPC streaming is awkward; raw handlers + AI SDK are not.

## 1. tRPC Routers

```
appRouter
├── thread     list / get / create / rename / pin / archive / delete
├── message    listByThread (cursor-paginated)
├── project    crud + setContext
├── note       crud + listJournal / getJournalByDate
├── task       crud + bulkUpdateStatus
├── source     list / get / delete / retry
├── memory     search / list / create (explicit) / correct / forget
├── agentRun   list / get (with steps) / cancel
├── automation crud + toggle / runNow / listRuns
├── reminder   crud
├── dashboard  morningBrief / feed
├── integration list / disconnect
└── user       me / updatePreferences
```

Conventions: Zod input schemas (shared with `core/shared/schemas`), cursor pagination everywhere, all procedures behind `protectedProcedure` (session-checked), mutations emit `Event` rows.

## 2. Streaming Chat — `POST /api/chat`

The single most important endpoint. Vercel AI SDK data-stream protocol.

**Request**
```ts
{ threadId?: string;            // absent → create thread
  message: UIMessage;           // text + attachments
  mode?: "auto" | AgentName;    // palette can force an agent, default auto-route
  context?: { projectId?: string; noteId?: string } }  // "where the user is"
```

**Response** — AI SDK data stream with custom data parts, so the UI renders the full agent lifecycle:

| Stream part | UI effect |
| --- | --- |
| `data-status` `{phase:"routing"\|"planning"\|"acting"\|"reviewing"}` | thinking indicator states |
| `data-plan` `{steps:[{id,title,status}]}` | live plan checklist |
| `data-tool` `{name,input,status,output?}` | collapsible tool cards |
| `data-memory` `{recalled:[…]}` | "using what I know" affordance |
| `text-delta` | streamed answer |
| `data-suggestions` `{actions:[…]}` | follow-up action chips |

Server flow: auth → load thread + working memory → orchestrator graph (doc 04) → persist messages/steps → emit events → memory extraction enqueued (async, never blocks the stream).

## 3. Other Route Handlers

| Endpoint | Purpose |
| --- | --- |
| `POST /api/ingest` | Start ingestion (multipart file or `{url}`); returns `sourceId`; job runs in queue |
| `GET  /api/ingest/[id]/events` | SSE progress: parsing → chunking → embedding → ready |
| `POST /api/voice/transcribe` | Audio chunk → Whisper → text |
| `POST /api/voice/speak` | Text → TTS audio stream |
| `GET  /api/cron` | Scheduler tick (Vercel cron / Supabase cron; guarded by `CRON_SECRET`) — fires reminders, due automations, morning brief generation |
| `POST /api/webhooks/[provider]` | Inbound webhooks (GitHub, future MCP events); signature-verified |
| `GET  /api/auth/callback/[provider]` | OAuth callback for integrations |

## 4. Error Model

All non-stream responses: `{ ok: true, data } | { ok: false, error: { code, message, retryable } }`.
Codes: `UNAUTHORIZED`, `NOT_FOUND`, `RATE_LIMITED`, `PROVIDER_ERROR`, `BUDGET_EXCEEDED`, `VALIDATION`.
Streams signal errors via a terminal `data-error` part so the UI can render inline retry.

## 5. Internal Service Interfaces (core ports)

Infrastructure implements these; nothing above core knows which vendor is behind them:

```ts
interface LLMProvider   { stream(req): AsyncIterable<Delta>; complete(req): Promise<Completion> }
interface Embedder      { embed(texts: string[]): Promise<number[][]> }
interface SearchProvider{ search(q, opts): Promise<SearchResult[]> }   // Tavily | Exa
interface Scraper       { scrape(url): Promise<Document> }             // Firecrawl
interface Queue         { enqueue(job): Promise<void>; on(type, handler) }
interface Storage       { put/get/delete/signedUrl }
```

Rate limiting: per-user token bucket in Postgres (MVP) — chat 30/min, ingestion 10 concurrent, plus a daily LLM budget check (`BUDGET_EXCEEDED`).
