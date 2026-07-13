import type { UIMessage } from "ai";
import { db, DEFAULT_USER_ID, ensureDefaultUser } from "./supabase";

export interface ThreadRow {
  id: string;
  title: string | null;
}

/** Latest active thread, creating "General" on first run. */
export async function getOrCreateLatestThread(): Promise<ThreadRow> {
  await ensureDefaultUser();
  const { data } = await db
    .from("Thread")
    .select("id, title")
    .eq("userId", DEFAULT_USER_ID)
    .is("archivedAt", null)
    .order("updatedAt", { ascending: false })
    .limit(1);
  if (data && data.length > 0) return data[0] as ThreadRow;

  const thread = { id: crypto.randomUUID(), userId: DEFAULT_USER_ID, title: "General" };
  await db.from("Thread").insert(thread);
  return { id: thread.id, title: thread.title };
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
  await db.from("Message").insert([
    { id: user.id, threadId, role: "user", content: user.parts },
    { id: assistant.id, threadId, role: "assistant", content: assistant.parts },
  ]);
  await db.from("Thread").update({ updatedAt: new Date().toISOString() }).eq("id", threadId);
}
