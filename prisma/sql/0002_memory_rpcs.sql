-- SAGE memory RPCs. Paste into Supabase SQL Editor and run.

-- Semantic memory recall (pgvector cosine ANN)
create or replace function match_memories(
  query_embedding vector(1536),
  match_count int default 12,
  p_user_id text default null
)
returns table(id text, type text, content text, importance double precision,
              confidence double precision, similarity double precision)
language sql stable as $$
  select m.id, m.type, m.content, m.importance, m.confidence,
         1 - (m.embedding <=> query_embedding) as similarity
  from "Memory" m
  where m.embedding is not null
    and m."supersededBy" is null
    and (p_user_id is null or m."userId" = p_user_id)
  order by m.embedding <=> query_embedding
  limit match_count;
$$;

-- Recall bookkeeping: bump access stats on used memories
create or replace function touch_memories(p_ids text[])
returns void language sql as $$
  update "Memory"
  set "accessCount" = "accessCount" + 1,
      "lastAccessedAt" = now()
  where id = any(p_ids);
$$;
