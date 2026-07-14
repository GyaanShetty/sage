import type { UIMessage } from "ai";
import { db, DEFAULT_USER_ID, ensureDefaultUser } from "./supabase";

export interface ThreadRow {
  id: string;
  title: string | null;
  updatedAt?: string;
}

export async function listThreads(): Promise<ThreadRow[]> {
  await ensureDefaultUser();
  const { data } = await db
    .from("Thread")
    .select("id, title, updatedAt")
    .eq("userId", DEFAULT_USER_ID)
    .is("archivedAt", null)
    .order("updatedAt", { ascending: false })
    .limit(50);
  return (data ?? []) as ThreadRow[];
}

export async function createThread(title = "New chat"): Promise<ThreadRow> {
  await ensureDefaultUser();
  const thread = {
    id: crypto.randomUUID(),
    userId: DEFAULT_USER_ID,
    title,
    updatedAt: new Date().toISOString(),
  };
  const { error } = await db.from("Thread").insert(thread);
  if (error) console.error("[threads] create failed:", error.message);
  return { id: thread.id, title: thread.title };
}

export async function getThread(id: string): Promise<ThreadRow | null> {
  const { data } = await db
    .from("Thread")
    .select("id, title")
    .eq("id", id)
    .eq("userId", DEFAULT_USER_ID)
    .maybeSingle();
  return (data as ThreadRow) ?? null;
}

/** Latest active thread, creating "General" on first run. */
export async function getOrCreateLatestThread(): Promise<ThreadRow> {
  const threads = await listThreads();
  if (threads.length > 0) return threads[0];
  return createThread("General");
}

export async function loadThreadMessages(threadId: string): Promise<UIMessage[]> {
  const { data } = await db
    .from("Message")
    .select("id, role, content")
    .eq("threadId", threadId)
    .order("createdAt", { ascending: true })
    .limit(200);
  return (data ?? []).map((row) => ({
    id: row.id,
    role: row.role as UIMessage["role"],
    parts: row.content as UIMessage["parts"],
  }));
}

export async function saveExchange(threadId: string, user: UIMessage, assistant: UIMessage) {
  const { error } = await db.from("Message").insert([
    { id: user.id, threadId, role: "user", content: user.parts },
    { id: assistant.id, threadId, role: "assistant", content: assistant.parts },
  ]);
  if (error) console.error("[threads] saveExchange failed:", error.message);
  await db.from("Thread").update({ updatedAt: new Date().toISOString() }).eq("id", threadId);
}

/** Set an auto-title from the first user message if still untitled. */
export async function maybeTitleThread(threadId: string, firstUserText: string) {
  const { data } = await db.from("Thread").select("title").eq("id", threadId).maybeSingle();
  const current = data?.title as string | null | undefined;
  if (current && current !== "New chat" && current !== "General") return;
  const title = firstUserText.replace(/\s+/g, " ").trim().slice(0, 60);
  if (title) await db.from("Thread").update({ title }).eq("id", threadId);
}
