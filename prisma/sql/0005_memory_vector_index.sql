-- Make memory recall stop being the slowest thing in a reply.
-- Paste into the Supabase SQL Editor and run. Safe to re-run.
--
-- match_memories orders by `embedding <=> query_embedding` with no index on
-- that column, so every recall was a sequential scan computing a 1536-dimension
-- cosine distance for every memory on file. Measured at ~1.0-1.2s — and it sits
-- in front of the model call, so it was pure dead air before SAGE said anything
-- at all, on every single message. It also got worse with every memory stored,
-- which is the wrong direction for a system whose whole point is remembering
-- more over time.
--
-- HNSW rather than IVFFlat: it needs no training pass, does not degrade as rows
-- are added, and the memory table is far too small for IVFFlat's list tuning to
-- be worth reasoning about.

create index concurrently if not exists memory_embedding_hnsw
  on "Memory" using hnsw (embedding vector_cosine_ops)
  -- The partial predicate mirrors the RPC's own filters, so the index covers
  -- exactly the rows it searches. expiresAt is deliberately not in here: now()
  -- is not immutable and cannot appear in an index predicate. It stays a cheap
  -- filter on the handful of rows the index returns.
  where embedding is not null and "supersededBy" is null;

-- The other half of recall: touch_memories updates by id (already indexed), but
-- the non-vector fallback path orders by importance and createdAt per user.
create index concurrently if not exists memory_user_importance
  on "Memory" ("userId", importance desc, "createdAt" desc)
  where "supersededBy" is null;
