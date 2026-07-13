# 03 — Memory Architecture

Memory is SAGE's moat. Design goal: after a month of use, SAGE should know you the way a great chief of staff would — without you ever "teaching" it.

## 1. Four Memory Layers

| Layer | Storage | Lifetime | Contents |
| --- | --- | --- | --- |
| **Working memory** | assembled per-request (not stored) | one request | current thread window, active project context, recalled memories, screen context |
| **Short-term (episodic)** | `Thread.summary` + recent `Message`s | days–weeks | rolling conversation summaries; compressed as threads grow |
| **Long-term (semantic)** | `Memory` table + pgvector | permanent (with decay) | facts, preferences, goals, routines, skills, relationships |
| **Knowledge** | `Source`/`Chunk` + pgvector | until deleted | ingested documents — *about the world*, vs Memory which is *about the user* |

## 2. Write Path — Extraction

Runs **async after each exchange** (queue job; never blocks chat):

```
messages → cheap model (Haiku) extraction pass
  → candidate memories: {type, content, confidence, evidence}
  → dedupe: embed candidate, ANN search existing memories (cosine > 0.88)
      ├─ near-duplicate      → reinforce: importance += boost, accessCount++
      ├─ contradiction       → supersede: new memory, old.supersededBy = new.id
      └─ novel               → insert with embedding
  → emit memory.extracted events
```

Extraction prompt targets the seven types: `fact` ("works at X"), `preference` ("hates verbose emails"), `goal` ("shipping SAGE MVP by Sept"), `routine` ("gym Mon/Wed/Fri"), `skill` ("expert in TS, learning Rust"), `relationship` ("Priya = cofounder"), `episode` ("decided to use pgvector on 2026-07-13, because…").

Explicit path: "remember that…" routes straight to `memory.create` with `sourceType: "explicit"`, confidence 1.0.

## 3. Read Path — Recall

On every orchestrator run, working memory is assembled with a token budget (~2.5k tokens):

```
recall(query, context):
  1. embed(user message + thread summary)
  2. ANN over Memory  (top 12, filtered by userId)
  3. rerank score = 0.55·similarity + 0.20·importance + 0.15·recency(lastAccessed)
                  + 0.10·typeBoost(context)        // e.g. coding task boosts "skill"
  4. take top N under token budget; bump accessCount/lastAccessedAt
  5. render as a "What I know that's relevant" system block, each with memory id
```

Memory ids in the prompt let the model *cite* memories, which the UI surfaces ("I remembered you prefer X") — trust through transparency.

## 4. Maintenance — Consolidation (nightly job)

- **Decay:** `importance *= 0.995` daily for unaccessed memories; floor at 0.05, never delete (archive below threshold — excluded from recall, visible in browser).
- **Merge:** cluster near-duplicates accumulated during the day into single richer memories.
- **Summarize episodes:** week-old episodic memories compress into higher-level narratives.
- **Thread compression:** threads > 40 messages get their oldest half folded into `Thread.summary` (map-reduce summarize).

## 5. User Control (Memory Browser feature)

Non-negotiable for trust: `/memory` shows everything, filterable by type; edit (creates supersession), forget (hard delete + purge from any prompt caches), pin (importance lock at 1.0), and "why do you think this?" (walks to source message/document via `sourceId`).

## 6. Knowledge Base retrieval (RAG)

Separate recall path, merged in working memory when relevant:

- Hybrid search: pgvector ANN + Postgres full-text (`ts_rank`), reciprocal-rank-fusion.
- Scoped: project context auto-filters to that project's sources.
- Chunking: structure-aware (headings for docs/web, pages for PDF, timestamps for YouTube, files/symbols for GitHub), 400–700 tokens, 15% overlap, heading-path prepended to each chunk before embedding.

## 7. Failure Modes Considered

- **Prompt bloat** → hard token budget + rerank, never "stuff everything".
- **Stale beliefs** → supersession + confidence surfaced to model ("low confidence, verify").
- **Creepiness** → extraction prompt excludes sensitive categories (health/political/etc.) unless user explicitly asks SAGE to track them (Health Agent opts in).
- **Poisoning via ingested docs** → document-derived memories capped at confidence 0.6 and always attributed; injection defenses in doc 06.
