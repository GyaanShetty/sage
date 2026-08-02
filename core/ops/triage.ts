import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/infrastructure/llm";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { listErrors, type ErrorReport } from "./errors";

/**
 * Turn captured errors into something actionable.
 *
 * The model gets the error and a list of the repository's files — never file
 * contents, and never anything it could act on directly. It proposes a
 * diagnosis, the likely file, and a fix in words. Nothing is written, nothing
 * is deployed: this is the part of "self-building" that is safe to run
 * unattended, and the rest is a review step that only you can do.
 *
 * A proposal is stored against the error's fingerprint, so it survives the next
 * occurrence and you can see whether a suggestion was already tried.
 */

const TYPE = "ops.triage";

export const triageSchema = z.object({
  diagnosis: z.string().describe("What is actually going wrong, in one or two sentences"),
  likelyFiles: z.array(z.string()).describe("Repository paths most likely responsible, best guess first"),
  fix: z.string().describe("The change to make, described precisely enough to implement"),
  confidence: z.enum(["high", "medium", "low"]),
  severity: z.enum(["breaks-feature", "degrades", "cosmetic", "noise"])
    .describe("noise = not a real problem, e.g. an aborted fetch from a page navigation"),
});
export type Triage = z.infer<typeof triageSchema> & {
  fingerprint: string;
  at: string;
  message: string;
};

const PROMPT = `You are triaging runtime errors in SAGE, a Next.js 15 App Router application in TypeScript.

Stack: Next.js 15, React 19, Supabase (Postgres via supabase-js), Vercel AI SDK with Gemini, Tailwind v4, deployed on Vercel serverless functions in the sin1 region.

Rules:
- Be concrete. "Add error handling" is not a fix; "the fetch in features/x/y.tsx does not check res.ok before calling .json(), so an HTML error page throws a parse error" is.
- Say when you do not know. Low confidence with an honest guess beats confident invention.
- Mark as "noise" anything that is not a real defect: aborted fetches from navigation, extension interference, ResizeObserver loop warnings, network blips on a flaky connection.
- You are given file PATHS only, not contents. Name the file you would open first.`;

/** Ask for a proposal on one error. */
export async function triageError(err: ErrorReport, files: string[]): Promise<Triage | null> {
  const model = getModel("smart") ?? getModel("fast");
  if (!model) return null;

  try {
    const { object } = await generateObject({
      model,
      schema: triageSchema,
      system: PROMPT,
      prompt:
        `Error (${err.side}, seen ${err.count}×, at ${err.where}):\n${err.message}\n\n` +
        (err.stack ? `Stack:\n${err.stack.slice(0, 1500)}\n\n` : "") +
        (err.context ? `Context: ${JSON.stringify(err.context).slice(0, 500)}\n\n` : "") +
        `Repository files:\n${files.slice(0, 400).join("\n")}`,
    });

    const triage: Triage = {
      ...object,
      likelyFiles: object.likelyFiles.slice(0, 5),
      fingerprint: err.fingerprint,
      at: new Date().toISOString(),
      message: err.message,
    };

    await db.from("Event").insert({
      id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: TYPE, payload: triage,
    });
    return triage;
  } catch {
    return null;
  }
}

/** Triage the loudest unresolved errors that have not been looked at yet. */
export async function triageOutstanding(files: string[], limit = 3): Promise<Triage[]> {
  const [errors, seen] = await Promise.all([listErrors(), listTriage()]);
  const done = new Set(seen.map((t) => t.fingerprint));
  const todo = errors.filter((e) => !done.has(e.fingerprint)).slice(0, limit);

  const out: Triage[] = [];
  for (const e of todo) {
    const t = await triageError(e, files);
    if (t) out.push(t);
  }
  return out;
}

export async function listTriage(limit = 50): Promise<Triage[]> {
  const { data } = await db
    .from("Event")
    .select("payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE)
    .order("createdAt", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => r.payload as Triage).filter((t) => t?.fingerprint);
}
