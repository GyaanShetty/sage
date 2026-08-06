import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

/**
 * A research workspace: a conversation with files in it.
 *
 * The research agent could read the web and the knowledge base could hold a
 * PDF, but neither could take a folder of lecture slides, a photo of a
 * whiteboard and a spreadsheet and answer questions across them. That is what
 * he actually does with ChatGPT, and it is the one shape SAGE did not have.
 *
 * ── Why uploads do not go through the API ──────────────────────────────────
 *
 * A Vercel function body is capped at about 4.5MB, which rules out anything
 * worth calling a "huge file". So the browser uploads straight to Supabase
 * Storage using a short-lived signed URL and only tells the server where it
 * landed. The bytes never touch a serverless function, so the ceiling is the
 * storage quota rather than a request limit.
 */

const BUCKET = "research";
const THREAD_TYPE = "research.thread";
const MSG_TYPE = "research.message";

export interface Attachment {
  id: string;
  name: string;
  /** Path inside the bucket, not a URL — URLs expire, paths do not. */
  path: string;
  mime: string;
  size: number;
  /** Extracted text, when the file had any worth extracting. */
  text?: string | null;
  /** Set when the file could not be read, so the UI stops promising it was. */
  note?: string | null;
  addedAt: string;
}

export interface Message {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  attachmentIds?: string[];
  at: string;
}

export interface Thread {
  id: string;
  title: string;
  attachments: Attachment[];
  createdAt: string;
  updatedAt: string;
}

/** What SAGE can actually read, as opposed to merely store. */
export function readability(mime: string, name: string): "text" | "image" | "pdf" | "opaque" {
  const n = name.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (
    mime.startsWith("text/") ||
    /\.(txt|md|csv|tsv|json|ya?ml|ts|tsx|js|jsx|py|java|c|cpp|go|rs|sql|html|css|log)$/.test(n)
  ) return "text";
  // Video and audio land here. Storing them is honest; claiming to have
  // watched them would not be — see the note set on upload.
  return "opaque";
}

/**
 * Make sure the bucket exists.
 *
 * Private, so nothing uploaded is reachable without a signed URL — a research
 * workspace holds coursework, contracts and photographs of whiteboards.
 */
async function ensureBucket(): Promise<void> {
  const { data } = await db.storage.getBucket(BUCKET);
  if (data) return;
  await db.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: 200 * 1024 * 1024,
  });
}

/** A short-lived URL the browser can PUT straight to. */
export async function signUpload(threadId: string, name: string): Promise<{ path: string; token: string } | { error: string }> {
  await ensureBucket();
  const safe = name.replace(/[^\w.\- ]/g, "_").slice(-80);
  const path = `${threadId}/${crypto.randomUUID()}-${safe}`;

  const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { error: error?.message ?? "Couldn't prepare the upload." };
  return { path, token: data.token };
}

/** A short-lived URL for reading one back — for previews and downloads. */
export async function signDownload(path: string, seconds = 3600): Promise<string | null> {
  const { data } = await db.storage.from(BUCKET).createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}

export async function fileBytes(path: string): Promise<Buffer | null> {
  const { data } = await db.storage.from(BUCKET).download(path);
  if (!data) return null;
  return Buffer.from(await data.arrayBuffer());
}

// ── threads ─────────────────────────────────────────────────────────────────

export async function listThreads(limit = 30): Promise<Thread[]> {
  const { data } = await db
    .from("Event").select("id, payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", THREAD_TYPE)
    .order("createdAt", { ascending: false }).limit(limit);
  return (data ?? []).map((r) => ({ id: r.id as string, ...(r.payload as Omit<Thread, "id">) }));
}

export async function getThread(id: string): Promise<Thread | null> {
  const { data } = await db
    .from("Event").select("id, payload")
    .eq("id", id).eq("userId", DEFAULT_USER_ID).eq("type", THREAD_TYPE)
    .maybeSingle();
  return data ? { id: data.id as string, ...(data.payload as Omit<Thread, "id">) } : null;
}

export async function createThread(title = "Untitled"): Promise<Thread> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const thread: Thread = { id, title, attachments: [], createdAt: now, updatedAt: now };
  await db.from("Event").insert({
    id, userId: DEFAULT_USER_ID, type: THREAD_TYPE,
    payload: { title, attachments: [], createdAt: now, updatedAt: now },
  });
  return thread;
}

async function saveThread(thread: Thread): Promise<void> {
  const { id, ...payload } = thread;
  await db.from("Event").update({ payload: { ...payload, updatedAt: new Date().toISOString() } }).eq("id", id);
}

export async function renameThread(id: string, title: string): Promise<void> {
  const thread = await getThread(id);
  if (!thread) return;
  await saveThread({ ...thread, title: title.trim().slice(0, 120) || "Untitled" });
}

export async function deleteThread(id: string): Promise<void> {
  const thread = await getThread(id);
  // Take the files with it. Orphaned blobs in a 1GB bucket are a slow leak
  // nobody ever goes looking for.
  if (thread?.attachments.length) {
    await db.storage.from(BUCKET).remove(thread.attachments.map((a) => a.path)).catch(() => undefined);
  }
  const { trashRow } = await import("@/core/ops/trash");
  await trashRow("Event", id).catch(() => undefined);
}

/**
 * Register an uploaded file and pull whatever text it has.
 *
 * Extraction happens once, here, rather than on every question: a 200-page PDF
 * re-parsed per message would be most of a request budget spent re-learning
 * something already known.
 */
export async function attach(
  threadId: string,
  file: { name: string; path: string; mime: string; size: number },
): Promise<Attachment | { error: string }> {
  const thread = await getThread(threadId);
  if (!thread) return { error: "No such thread." };

  const kind = readability(file.mime, file.name);
  let text: string | null = null;
  let note: string | null = null;

  try {
    if (kind === "text") {
      const bytes = await fileBytes(file.path);
      text = bytes ? bytes.toString("utf8").slice(0, 200_000) : null;
    } else if (kind === "pdf") {
      const bytes = await fileBytes(file.path);
      if (bytes) {
        const { extractPdfText } = await import("@/infrastructure/pdf/extract");
        text = (await extractPdfText(bytes)).slice(0, 200_000);
      }
      if (!text?.trim()) note = "No text layer — this looks like a scan, so I can only see it as pages, not read it.";
    } else if (kind === "image") {
      note = "Image — I look at it directly when you ask about it.";
    } else {
      // Said plainly rather than silently doing nothing.
      note = file.mime.startsWith("video/") || file.mime.startsWith("audio/")
        ? "Stored, but I can't watch or listen to it yet — describe what matters and I'll work from that."
        : "Stored. I can't read this format, so ask about it in words.";
    }
  } catch (e) {
    note = `Couldn't read it: ${(e as Error).message.slice(0, 120)}`;
  }

  const attachment: Attachment = {
    id: crypto.randomUUID(),
    name: file.name,
    path: file.path,
    mime: file.mime,
    size: file.size,
    text,
    note,
    addedAt: new Date().toISOString(),
  };

  await saveThread({ ...thread, attachments: [...thread.attachments, attachment] });
  return attachment;
}

export async function detach(threadId: string, attachmentId: string): Promise<void> {
  const thread = await getThread(threadId);
  if (!thread) return;
  const going = thread.attachments.find((a) => a.id === attachmentId);
  if (going) await db.storage.from(BUCKET).remove([going.path]).catch(() => undefined);
  await saveThread({ ...thread, attachments: thread.attachments.filter((a) => a.id !== attachmentId) });
}

// ── messages ────────────────────────────────────────────────────────────────

export async function listMessages(threadId: string): Promise<Message[]> {
  const { data } = await db
    .from("Event").select("id, payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", MSG_TYPE)
    .eq("payload->>threadId", threadId)
    .order("createdAt", { ascending: true }).limit(200);
  return (data ?? []).map((r) => ({ id: r.id as string, ...(r.payload as Omit<Message, "id">) }));
}

export async function addMessage(threadId: string, role: Message["role"], content: string): Promise<Message> {
  const id = crypto.randomUUID();
  const message: Message = { id, threadId, role, content, at: new Date().toISOString() };
  await db.from("Event").insert({
    id, userId: DEFAULT_USER_ID, type: MSG_TYPE,
    payload: { threadId, role, content, at: message.at },
  });
  return message;
}
