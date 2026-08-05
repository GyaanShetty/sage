import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { putRepoFile, repoVisibility } from "@/infrastructure/integrations/github";

/**
 * A copy of everything, somewhere else.
 *
 * Every note, memory, workout, trade, decision and journal entry in SAGE lives
 * in one Supabase free project. That plan has no point-in-time recovery and
 * pauses after a week of inactivity. One bad migration, one mis-click in the
 * dashboard, one project deleted, and there is no version of this that comes
 * back — which makes it the only genuinely unrecoverable failure in the whole
 * system. Everything else here is a feature; this is insurance.
 *
 * Two rules shape the design:
 *
 *   1. It leaves the building. A backup inside the database it is backing up
 *      is not a backup. It goes to a private GitHub repo — free, versioned,
 *      already reachable — and can also be downloaded straight from Settings so
 *      it works before any of that is configured.
 *   2. Restore is boring and additive. It upserts by primary key and never
 *      deletes, so running it twice is harmless and running it by accident
 *      cannot destroy newer data.
 */

/**
 * Tables in dependency order — parents before children.
 *
 * The order matters only for restore: inserting a Message whose Thread does
 * not exist yet fails on the foreign key. Backing up is order-independent, but
 * one list serving both means restore cannot drift out of step with backup.
 */
export const TABLES = [
  "User",
  "Integration",
  "Thread",
  "Message",
  "Memory",
  "Source",
  "Chunk",
  "Project",
  "Note",
  "Task",
  "AgentRun",
  "AgentStep",
  "Automation",
  "AutomationRun",
  "Reminder",
  "Event",
] as const;

export type TableName = (typeof TABLES)[number];

export interface BackupFile {
  sage: "backup";
  version: 1;
  takenAt: string;
  userId: string;
  counts: Record<string, number>;
  /** Tables that hit the row ceiling — their data is partial, and says so. */
  truncated: string[];
  tables: Record<string, Record<string, unknown>[]>;
}

/**
 * Rows per table. Generous, but not unbounded: this has to serialise in one
 * function invocation, and an unbounded read of Event on a bad day would blow
 * the memory limit and produce nothing at all — the worst outcome for a backup.
 */
const MAX_ROWS = 20_000;
const PAGE = 1000;

/**
 * Rows that must not leave in a backup.
 *
 * API keys are stored encrypted, and the secret that decrypts them is not in
 * the database — so shipping them would be safe in theory. In practice it
 * would mean a copy of live credentials sitting in a GitHub repo forever,
 * defended by one environment variable never being leaked at the same time.
 * The cost of leaving them out is re-pasting a key after a restore, which
 * takes thirty seconds. That is not a close call.
 *
 * The Integration table's OAuth tokens are a different matter: they are
 * refresh tokens SAGE cannot ask him to retype, and losing them means
 * reconnecting Google by hand — so those stay, and are the reason BACKUP_REPO
 * is checked for being private on every single run.
 */
const NEVER_BACKED_UP = new Set(["ops.apikeys"]);

function redact(table: string, rows: Record<string, unknown>[]): Record<string, unknown>[] {
  if (table !== "Event") return rows;
  return rows.filter((r) => !NEVER_BACKED_UP.has(String(r.type)));
}

async function dumpTable(table: string): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await db.from(table).select("*").range(from, from + PAGE - 1);
    if (error) break;                       // table absent or unreadable: skip, don't abort the run
    rows.push(...redact(table, (data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

/** Everything, as one object. */
export async function exportAll(): Promise<BackupFile> {
  const tables: Record<string, Record<string, unknown>[]> = {};
  const counts: Record<string, number> = {};
  const truncated: string[] = [];

  // Deliberately sequential. Sixteen parallel full-table reads against a free
  // Postgres instance is how you get a connection-pool error instead of a
  // backup, and nothing is waiting on this.
  for (const table of TABLES) {
    const { rows, truncated: cut } = await dumpTable(table);
    tables[table] = rows;
    counts[table] = rows.length;
    if (cut) truncated.push(table);
  }

  return {
    sage: "backup",
    version: 1,
    takenAt: new Date().toISOString(),
    userId: DEFAULT_USER_ID,
    counts,
    truncated,
    tables,
  };
}

export interface BackupResult {
  ok: boolean;
  takenAt: string;
  rows: number;
  bytes: number;
  counts: Record<string, number>;
  truncated: string[];
  /** Where it went, when it went anywhere. */
  url?: string;
  error?: string;
}

/**
 * Take a backup and push it to the configured repo.
 *
 * One file per day rather than per run: several backups on the same day
 * overwrite each other, and GitHub keeps every version in the commit history
 * anyway, so nothing is lost and the folder stays readable years from now.
 */
export async function runBackup(): Promise<BackupResult> {
  const file = await exportAll();
  const json = JSON.stringify(file);
  const rows = Object.values(file.counts).reduce((a, n) => a + n, 0);
  const base: BackupResult = {
    ok: false,
    takenAt: file.takenAt,
    rows,
    bytes: json.length,
    counts: file.counts,
    truncated: file.truncated,
  };

  const repo = process.env.BACKUP_REPO;
  if (!repo) return { ...base, error: "No BACKUP_REPO set — set it to a private owner/repo to store backups off-site." };

  // Never write a life's worth of private data into a public repo, whatever
  // the setting says. This is checked every run, because a repo can be flipped
  // to public long after it was configured.
  const visibility = await repoVisibility(repo);
  if (visibility === null) return { ...base, error: `Can't see ${repo} — check the name and that GITHUB_TOKEN has repo scope.` };
  if (visibility === "public") return { ...base, error: `${repo} is public. Refusing to write your data there — make it private first.` };

  const day = file.takenAt.slice(0, 10);
  const put = await putRepoFile(repo, `backups/${day}.json`, json, `SAGE backup ${day} — ${rows} rows`);
  if (!put.ok) return { ...base, error: put.error };

  await recordBackup({ ...base, ok: true, url: put.url });
  return { ...base, ok: true, url: put.url };
}

const LOG_TYPE = "ops.backup";

async function recordBackup(result: BackupResult): Promise<void> {
  await db.from("Event").insert({
    id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: LOG_TYPE,
    payload: { takenAt: result.takenAt, rows: result.rows, bytes: result.bytes, url: result.url ?? null },
  }).then(() => undefined, () => undefined);
}

/** The last backup, so the UI can say how long the data has been at risk. */
export async function lastBackup(): Promise<{ takenAt: string; rows: number; url: string | null; ageDays: number } | null> {
  const { data } = await db
    .from("Event").select("payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", LOG_TYPE)
    .order("createdAt", { ascending: false }).limit(1).maybeSingle();
  const p = data?.payload as { takenAt?: string; rows?: number; url?: string } | undefined;
  if (!p?.takenAt) return null;
  return {
    takenAt: p.takenAt,
    rows: p.rows ?? 0,
    url: p.url ?? null,
    ageDays: Math.floor((Date.now() - new Date(p.takenAt).getTime()) / 86_400_000),
  };
}

export interface RestoreResult { ok: boolean; restored: Record<string, number>; errors: string[] }

/**
 * Put a backup back.
 *
 * Upsert by id, never delete. A restore that removed rows absent from the file
 * would turn "I restored last week's backup" into "I deleted this week's work",
 * and the moment you reach for a restore is exactly the moment you cannot
 * afford a second mistake. Anything newer than the file simply survives it.
 */
export async function restoreBackup(file: BackupFile): Promise<RestoreResult> {
  const restored: Record<string, number> = {};
  const errors: string[] = [];

  if (file?.sage !== "backup" || !file.tables) {
    return { ok: false, restored, errors: ["That file is not a SAGE backup."] };
  }

  // Parents first: a Message whose Thread has not been restored yet fails on
  // the foreign key, and would be silently lost if the order were arbitrary.
  for (const table of TABLES) {
    const rows = file.tables[table];
    if (!Array.isArray(rows) || rows.length === 0) continue;

    let done = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await db.from(table).upsert(chunk, { onConflict: "id" });
      if (error) { errors.push(`${table}: ${error.message}`); break; }
      done += chunk.length;
    }
    restored[table] = done;
  }

  return { ok: errors.length === 0, restored, errors };
}
