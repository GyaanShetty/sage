-- SAGE knowledge search RPC. Paste into Supabase SQL Editor and run.

create or replace function match_chunks(
  query_embedding vector(1536),
  match_count int default 6,
  p_user_id text default null
)
returns table(id text, "sourceId" text, "sourceTitle" text, content text, similarity double precision)
language sql stable as $$
  select c.id, c."sourceId", s.title as "sourceTitle", c.content,
         1 - (c.embedding <=> query_embedding) as similarity
  from "Chunk" c
  join "Source" s on s.id = c."sourceId"
  where c.embedding is not null
    and s.status = 'ready'
    and (p_user_id is null or c."userId" = p_user_id)
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
