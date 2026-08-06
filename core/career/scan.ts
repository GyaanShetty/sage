import { startOfTodayUtc } from "@/lib/config";
import { trashRow } from "@/core/ops/trash";
import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/infrastructure/llm";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { searchGmail } from "@/infrastructure/integrations/google";

export const STAGES = ["applied", "assessment", "interview", "offer", "rejected"] as const;
export type Stage = (typeof STAGES)[number];

export interface Attachment { name: string; path: string; size: number; addedAt: string }

/** One stage transition. Appended on every move so the pipeline has a trail:
 *  without it there was no way to tell an application that reached interview
 *  yesterday from one that has been sitting there for six weeks. */
export interface StageChange { stage: Stage; at: string }

export interface Application {
  id: string;
  company: string;
  role: string;
  stage: Stage;
  deadline?: string | null;
  notes?: string | null;
  attachments?: Attachment[];
  history?: StageChange[];
  source: "gmail" | "manual";
  updatedAt: string;
}

const TYPE = "career.application";

export async function listApplications(): Promise<Application[]> {
  const { data } = await db
    .from("Event")
    .select("id, payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE)
    .order("createdAt", { ascending: false })
    .limit(200);
  return (data ?? []).map((r) => ({ id: r.id as string, ...(r.payload as Omit<Application, "id">) }));
}

export async function upsertApplication(app: Partial<Application> & { id?: string }): Promise<string> {
  if (app.id) {
    const { data } = await db.from("Event").select("payload").eq("id", app.id).maybeSingle();
    const prev = (data?.payload ?? {}) as Partial<Application>;
    const now = new Date().toISOString();
    const merged = { ...prev, ...app, updatedAt: now } as Partial<Application>;

    // Record the transition, not just the destination. Only an actual change
    // counts — saving a note must not look like pipeline movement.
    if (app.stage && app.stage !== prev.stage) {
      const history = [...(prev.history ?? [])];
      if (history.length === 0 && prev.stage) {
        // Backfill the stage it was already in, so the first move produces a
        // segment rather than a lone point.
        history.push({ stage: prev.stage, at: (prev.updatedAt as string) ?? now });
      }
      history.push({ stage: app.stage, at: now });
      merged.history = history.slice(-20);
    }

    delete (merged as { id?: string }).id;
    await db.from("Event").update({ payload: merged }).eq("id", app.id);
    return app.id;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const stage = app.stage ?? "applied";
  const payload = {
    company: app.company ?? "Unknown", role: app.role ?? "—", stage,
    deadline: app.deadline ?? null, notes: app.notes ?? null, source: app.source ?? "manual",
    history: [{ stage, at: now }],
    updatedAt: now,
  };
  await db.from("Event").insert({ id, userId: DEFAULT_USER_ID, type: TYPE, payload });
  return id;
}

export async function deleteApplication(id: string): Promise<void> {
  await trashRow("Event", id);
}

const scanSchema = z.object({
  applications: z.array(z.object({
    company: z.string(),
    role: z.string().describe("Role/programme applied for; '—' if unclear"),
    stage: z.enum(STAGES),
    deadline: z.string().nullable().describe("ISO date if a deadline/interview date is mentioned, else null"),
  })),
});

/** Scan Gmail for recruiting emails and reconcile them into the pipeline.
 *  Only adds companies not already tracked; updates stage if further along. */
export async function scanInbox(): Promise<{ added: number; updated: number }> {
  const model = getModel("smart");
  if (!model) return { added: 0, updated: 0 };

  const emails = await searchGmail(
    'newer_than:60d (application OR applied OR internship OR interview OR "online assessment" OR OA OR "assessment" OR shortlisted OR "moving forward" OR offer OR "regret to inform" OR "not to move forward")',
    25,
  ).catch(() => null);
  if (!emails?.length) return { added: 0, updated: 0 };

  const { object } = await generateObject({
    model,
    schema: scanSchema,
    system: `Extract job/internship applications from these recruiting emails. One entry per company+role. Infer the stage: applied (confirmation), assessment (OA/coding test/case), interview (interview scheduled/invited), offer (offer extended), rejected (regret/not moving forward). Ignore marketing, newsletters, and job-board digests. Deduplicate companies.`,
    prompt: emails.map((e, i) => `${i + 1}. From ${e.from} — ${e.subject}: ${e.snippet}`).join("\n"),
  }).catch(() => ({ object: { applications: [] } }));

  const existing = await listApplications();
  const stageRank = (s: Stage) => STAGES.indexOf(s);
  let added = 0, updated = 0;

  for (const a of object.applications) {
    const match = existing.find((e) => e.company.toLowerCase() === a.company.toLowerCase());
    if (!match) {
      await upsertApplication({ ...a, source: "gmail" });
      added++;
    } else if (a.stage !== "applied" && stageRank(a.stage) > stageRank(match.stage) && match.stage !== "offer") {
      await upsertApplication({ id: match.id, stage: a.stage, deadline: a.deadline ?? match.deadline });
      updated++;
    }
  }
  return { added, updated };
}

/** Cron-safe: runs the inbox scan at most once per day (the /career button uses
 *  scanInbox directly, un-throttled). */
export async function maybeScanInbox(): Promise<{ added: number; updated: number }> {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const { data } = await db.from("Event").select("id")
    .eq("userId", DEFAULT_USER_ID).eq("type", "career.autoscan")
    .gte("createdAt", startOfTodayUtc()).limit(1).maybeSingle();
  if (data) return { added: 0, updated: 0 };
  await db.from("Event").insert({ id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: "career.autoscan", payload: { day } });
  return scanInbox();
}
