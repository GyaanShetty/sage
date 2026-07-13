# 01 — Database Schema

Postgres (Supabase) + pgvector. Prisma as ORM; vector columns via `Unsupported("vector(1536)")` with raw SQL for similarity queries (wrapped in `infrastructure/db/vector.ts`).

Single-user first, but every table carries `userId` so multi-user/teams need no migration.

```prisma
// ──────────────── Identity ────────────────
model User {
  id            String   @id @default(cuid())
  email         String   @unique
  name          String?
  avatarUrl     String?
  preferences   Json     @default("{}")   // theme, hotkeys, voice settings, briefing time
  createdAt     DateTime @default(now())
  // relations: everything below
}

// OAuth connections to external services (Google, GitHub, …)
model Integration {
  id           String   @id @default(cuid())
  userId       String
  provider     String            // "google" | "github" | "spotify" | mcp server id
  scopes       String[]
  accessToken  String            // encrypted at rest (AES-256-GCM, key in env/KMS)
  refreshToken String?           // encrypted
  expiresAt    DateTime?
  status       String   @default("active")
  @@unique([userId, provider])
}

// ──────────────── Conversation ────────────────
model Thread {
  id         String   @id @default(cuid())
  userId     String
  projectId  String?            // optional: thread scoped to a workspace project
  title      String?            // AI-generated
  summary    String?            // rolling summary for context compression
  pinned     Boolean  @default(false)
  archivedAt DateTime?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  messages   Message[]
  @@index([userId, updatedAt])
}

model Message {
  id        String   @id @default(cuid())
  threadId  String
  role      String              // "user" | "assistant" | "system" | "tool"
  content   Json                // AI SDK message parts: text, tool-call, tool-result, file
  agentRunId String?            // links to the run that produced it
  tokens    Int?
  createdAt DateTime @default(now())
  @@index([threadId, createdAt])
}

// ──────────────── Memory (doc 03) ────────────────
model Memory {
  id          String   @id @default(cuid())
  userId      String
  type        String              // "fact" | "preference" | "goal" | "routine" | "skill" | "relationship" | "episode"
  content     String              // natural-language statement
  embedding   Unsupported("vector(1536)")?
  importance  Float    @default(0.5)   // 0..1, decays; boosted on recall
  confidence  Float    @default(0.8)
  sourceType  String              // "conversation" | "document" | "explicit" | "inferred"
  sourceId    String?
  supersededBy String?            // memory revision chain (never hard-delete)
  lastAccessedAt DateTime?
  accessCount Int      @default(0)
  expiresAt   DateTime?           // for time-bound facts
  createdAt   DateTime @default(now())
  @@index([userId, type])
}

// ──────────────── Knowledge Base ────────────────
model Source {
  id        String   @id @default(cuid())
  userId    String
  projectId String?
  kind      String              // "pdf" | "url" | "youtube" | "github" | "docs" | "note"
  title     String
  url       String?
  fileKey   String?             // Supabase storage key
  status    String   @default("pending") // pending|processing|ready|failed
  metadata  Json     @default("{}")      // page count, repo stats, video duration…
  error     String?
  createdAt DateTime @default(now())
  chunks    Chunk[]
}

model Chunk {
  id        String  @id @default(cuid())
  sourceId  String
  userId    String              // denormalized for fast RLS + filtered ANN search
  content   String
  embedding Unsupported("vector(1536)")?
  position  Int                 // order within source
  metadata  Json    @default("{}")  // page, heading path, timestamp (yt), file path (gh)
  @@index([sourceId, position])
}
// SQL migration adds: CREATE INDEX ON "Chunk" USING hnsw (embedding vector_cosine_ops);
//                     CREATE INDEX ON "Memory" USING hnsw (embedding vector_cosine_ops);

// ──────────────── Workspace ────────────────
model Project {
  id        String   @id @default(cuid())
  userId    String
  name      String
  emoji     String?
  status    String   @default("active")
  context   String?             // project brief injected into agent context
  createdAt DateTime @default(now())
  notes     Note[]
  tasks     Task[]
}

model Note {
  id        String   @id @default(cuid())
  userId    String
  projectId String?
  kind      String   @default("doc")  // "doc" | "whiteboard" | "journal"
  title     String
  content   Json                      // Tiptap JSON or React Flow JSON
  journalDate DateTime?               // set when kind = journal (unique per user/day)
  aiGenerated Boolean @default(false)
  updatedAt DateTime @updatedAt
  createdAt DateTime @default(now())
  @@index([userId, updatedAt])
}

model Task {
  id        String   @id @default(cuid())
  userId    String
  projectId String?
  title     String
  status    String   @default("todo")  // todo|doing|done|cancelled
  priority  Int      @default(2)       // 0 urgent … 3 low
  dueAt     DateTime?
  source    String   @default("user")  // "user" | "agent" | "automation"
  createdAt DateTime @default(now())
  @@index([userId, status, dueAt])
}

// ──────────────── Agents & Runs ────────────────
model AgentRun {
  id         String   @id @default(cuid())
  userId     String
  threadId   String?
  agent      String               // "orchestrator" | "research" | "coder" | …
  goal       String
  status     String   @default("running") // running|paused|done|failed|cancelled
  plan       Json?                // planner output: steps with status
  result     Json?
  costUsd    Float    @default(0)
  startedAt  DateTime @default(now())
  endedAt    DateTime?
  steps      AgentStep[]
  @@index([userId, startedAt])
}

model AgentStep {
  id        String   @id @default(cuid())
  runId     String
  index     Int
  kind      String               // "think" | "tool_call" | "delegate" | "review"
  name      String?              // tool or sub-agent name
  input     Json?
  output    Json?
  status    String
  latencyMs Int?
  createdAt DateTime @default(now())
  @@index([runId, index])
}

// ──────────────── Automation ────────────────
model Automation {
  id        String   @id @default(cuid())
  userId    String
  name      String
  trigger   Json                 // {type:"cron",expr}|{type:"event",event}|{type:"webhook"}
  workflow  Json                 // DAG of steps (React Flow-compatible)
  enabled   Boolean  @default(true)
  lastRunAt DateTime?
  createdAt DateTime @default(now())
  runs      AutomationRun[]
}

model AutomationRun {
  id           String   @id @default(cuid())
  automationId String
  status       String
  log          Json     @default("[]")
  startedAt    DateTime @default(now())
  endedAt      DateTime?
}

model Reminder {
  id        String   @id @default(cuid())
  userId    String
  text      String
  remindAt  DateTime
  recurring String?              // RRULE
  channel   String   @default("app")  // app|email|push
  status    String   @default("pending")
  @@index([userId, remindAt, status])
}

// ──────────────── Event Log (spine of the system) ────────────────
model Event {
  id        String   @id @default(cuid())
  userId    String
  type      String              // "message.created" | "memory.extracted" | "run.finished" | …
  payload   Json
  createdAt DateTime @default(now())
  @@index([userId, type, createdAt])
}
```

## Design decisions

1. **pgvector over a dedicated vector DB.** One database, transactional consistency between chunks/memories and their embeddings, RLS applies to vectors too. HNSW indexes handle <5M vectors easily; revisit only if we blow past that.
2. **`Message.content` as JSON parts** matches the Vercel AI SDK message format exactly — tool calls and streaming render without translation.
3. **Memories are immutable + supersession chain.** Contradiction handling (doc 03) writes a new memory and points `supersededBy` — full audit of what SAGE believed and when.
4. **Event table is the integration spine.** Memory extraction, dashboard feeds, and future MCP webhooks are all consumers of events, not coupled to features.
5. **RLS on every table** (`userId = auth.uid()`) even single-user — free multi-user later and defense-in-depth now.
