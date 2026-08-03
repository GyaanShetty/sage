-- Performance indexes.
--
-- Run once against the database (Supabase → SQL editor). CONCURRENTLY so it
-- never takes a write lock on a live table; that means each statement must be
-- run on its own, outside a transaction block.

-- AutomationRun had no index whatsoever. Every automations page load scans the
-- whole table, and the table grows by one row per automation per day forever,
-- so the page gets steadily slower with nothing to show for it. The order
-- matters: automationId narrows, startedAt DESC then satisfies "latest run"
-- without a sort.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "AutomationRun_automationId_startedAt_idx"
  ON "AutomationRun" ("automationId", "startedAt" DESC);

-- Retention prunes by (userId, type, createdAt), which the existing composite
-- index already covers. The link graph does not: it filters on JSON paths
-- inside payload, which no btree can serve. These two expression indexes make
-- "everything linked to this thing" an index lookup rather than a scan of
-- every edge ever created.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Event_link_from_idx"
  ON "Event" ((payload -> 'from' ->> 'kind'), (payload -> 'from' ->> 'id'))
  WHERE type = 'link.edge';

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Event_link_to_idx"
  ON "Event" ((payload -> 'to' ->> 'kind'), (payload -> 'to' ->> 'id'))
  WHERE type = 'link.edge';

-- Error grouping looks up one fingerprint on every captured error, and errors
-- arrive in bursts — exactly when the extra scan hurts most.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Event_error_fingerprint_idx"
  ON "Event" ((payload ->> 'fingerprint'))
  WHERE type = 'ops.error';

-- Deliberately NOT adding a Reminder index: (userId, remindAt, status) already
-- exists. A (userId, status, remindAt) variant would serve the cron sweep
-- slightly better, but a second index on a small, write-heavy table costs more
-- in write time and storage than it saves at this scale.
