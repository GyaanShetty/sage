import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { putRepoFile, repoFileExists } from "@/infrastructure/integrations/github";

/**
 * Pushing solutions to GitHub from inside SAGE.
 *
 * A DSA repo is a good habit and a miserable ritual: solve the problem, open
 * an editor, remember the folder convention, guess the file extension, write a
 * commit message, push. Six steps between having the answer and having it
 * filed, which is why so many of these repos stop in February.
 *
 * Here the repo, the folder and the naming are chosen once and remembered, so
 * the second solution onwards costs one button.
 *
 * No git binary is involved — GitHub's Contents API commits a file directly.
 * That is a real commit with real history; what it cannot do is a multi-file
 * atomic change, which a solutions repo never needs.
 */

const LOG_TYPE = "code.push";
const PREFS_TYPE = "code.pushprefs";

export interface Language {
  key: string;
  label: string;
  ext: string;
  /** Comment prefix, for the header stamped on a solution. */
  comment: string;
}

/**
 * Extensions matter more than they look: GitHub picks syntax highlighting and
 * language statistics from them, so a Python solution saved as .txt is invisible
 * in the repo's language bar — which for a repo meant to be shown to a recruiter
 * is the whole point of having it.
 */
export const LANGUAGES: Language[] = [
  { key: "python3", label: "Python", ext: "py", comment: "#" },
  { key: "cpp", label: "C++", ext: "cpp", comment: "//" },
  { key: "java", label: "Java", ext: "java", comment: "//" },
  { key: "javascript", label: "JavaScript", ext: "js", comment: "//" },
  { key: "typescript", label: "TypeScript", ext: "ts", comment: "//" },
  { key: "golang", label: "Go", ext: "go", comment: "//" },
  { key: "rust", label: "Rust", ext: "rs", comment: "//" },
  { key: "c", label: "C", ext: "c", comment: "//" },
  { key: "kotlin", label: "Kotlin", ext: "kt", comment: "//" },
  { key: "sql", label: "SQL", ext: "sql", comment: "--" },
  { key: "markdown", label: "Markdown", ext: "md", comment: "<!--" },
];

export function languageFor(key: string): Language {
  return LANGUAGES.find((l) => l.key === key) ?? LANGUAGES[0];
}

/**
 * A file name from a problem title.
 *
 * LeetCode's own convention — `two-sum.py` — sorts alphabetically, which
 * scatters a topic across the folder. Numbered titles keep the natural order
 * when they exist, and everything else falls back to the slug.
 */
export function fileNameFor(title: string, lang: string): string {
  const l = languageFor(lang);
  const numbered = /^(\d+)[.\s-]+(.*)$/.exec(title.trim());
  const base = numbered
    ? `${numbered[1].padStart(4, "0")}-${slug(numbered[2])}`
    : slug(title);
  return `${base || "solution"}.${l.ext}`;
}

function slug(s: string): string {
  return s.trim().toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60)
    .replace(/^-|-$/g, "");
}

/** Normalise a folder path: no leading or trailing slashes, no traversal. */
export function cleanFolder(folder: string): string {
  return folder
    .split("/")
    .map((p) => p.trim())
    .filter((p) => p && p !== "." && p !== "..")
    .join("/");
}

export interface PushInput {
  repo: string;
  folder: string;
  fileName: string;
  code: string;
  language: string;
  /** Prepended as a comment block: problem, link, complexity, notes. */
  header?: { title?: string; url?: string; complexity?: string; notes?: string };
  message?: string;
  /** Refuse rather than overwrite when something is already there. */
  overwrite?: boolean;
}

export interface PushResult {
  ok: boolean;
  path?: string;
  url?: string;
  error?: string;
  /** True when the push was blocked because a file is already at that path. */
  exists?: boolean;
}

/** A comment block at the top of the file, so the solution explains itself. */
export function buildHeader(lang: string, header: PushInput["header"]): string {
  if (!header) return "";
  const c = languageFor(lang).comment;
  const close = c === "<!--" ? " -->" : "";
  const lines: string[] = [];
  if (header.title) lines.push(`${c} ${header.title}${close}`);
  if (header.url) lines.push(`${c} ${header.url}${close}`);
  if (header.complexity) lines.push(`${c} ${header.complexity}${close}`);
  if (header.notes) {
    for (const line of header.notes.split("\n").slice(0, 8)) lines.push(`${c} ${line}${close}`);
  }
  return lines.length ? `${lines.join("\n")}\n\n` : "";
}

export async function pushCode(input: PushInput): Promise<PushResult> {
  const folder = cleanFolder(input.folder);
  const name = input.fileName.trim().replace(/[/\\]/g, "-");
  if (!input.repo || !name) return { ok: false, error: "Repo and file name are required." };
  if (!input.code.trim()) return { ok: false, error: "There's no code to push." };

  const path = folder ? `${folder}/${name}` : name;

  // Overwriting silently is the one behaviour that could lose work here, and
  // the likeliest way to hit it is re-pushing a problem you solved months ago
  // having forgotten. So it is asked about rather than assumed.
  if (!input.overwrite && (await repoFileExists(input.repo, path))) {
    return { ok: false, exists: true, error: `${path} already exists in ${input.repo}.` };
  }

  const body = buildHeader(input.language, input.header) + input.code.trimEnd() + "\n";
  const message = input.message?.trim() || `Add ${name}`;

  const put = await putRepoFile(input.repo, path, body, message);
  if (!put.ok) return { ok: false, error: put.error };

  await recordPush({ repo: input.repo, path, url: put.url, language: input.language, title: input.header?.title ?? name });
  return { ok: true, path, url: put.url };
}

export interface PushRecord {
  repo: string; path: string; url: string; language: string; title: string; at: string;
}

async function recordPush(r: Omit<PushRecord, "at">): Promise<void> {
  await db.from("Event").insert({
    id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: LOG_TYPE,
    payload: { ...r, at: new Date().toISOString() },
  }).then(() => undefined, () => undefined);
}

/** What has been pushed, newest first — the page's own history. */
export async function recentPushes(limit = 20): Promise<PushRecord[]> {
  const { data } = await db
    .from("Event").select("payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", LOG_TYPE)
    .order("createdAt", { ascending: false }).limit(limit);
  return (data ?? []).map((r) => r.payload as PushRecord);
}

export interface PushPrefs { repo: string; folder: string; language: string }

/**
 * The last repo, folder and language used.
 *
 * Remembered because the answer is the same every single time for weeks, and
 * re-choosing it on every push is exactly the friction that kills the habit.
 */
export async function getPushPrefs(): Promise<PushPrefs | null> {
  const { data } = await db
    .from("Event").select("payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", PREFS_TYPE)
    .order("createdAt", { ascending: false }).limit(1).maybeSingle();
  return (data?.payload as PushPrefs) ?? null;
}

export async function setPushPrefs(prefs: PushPrefs): Promise<void> {
  const { data: existing } = await db
    .from("Event").select("id")
    .eq("userId", DEFAULT_USER_ID).eq("type", PREFS_TYPE)
    .order("createdAt", { ascending: false }).limit(1).maybeSingle();

  if (existing) await db.from("Event").update({ payload: prefs }).eq("id", existing.id);
  else await db.from("Event").insert({ id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: PREFS_TYPE, payload: prefs });
}
