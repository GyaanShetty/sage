import type { Metadata } from "next";
import {
  WorkspaceView,
  type NoteRow,
  type TaskRow,
} from "@/features/workspace/components/workspace-view";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

export const metadata: Metadata = { title: "Workspace" };
export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const [{ data: tasks }, { data: notes }] = await Promise.all([
    db
      .from("Task")
      .select("id, title, status, priority, dueAt")
      .eq("userId", DEFAULT_USER_ID)
      .neq("status", "cancelled")
      .order("createdAt", { ascending: false })
      .limit(100),
    db
      .from("Note")
      .select("id, kind, title, content, updatedAt")
      .eq("userId", DEFAULT_USER_ID)
      .order("updatedAt", { ascending: false })
      .limit(100),
  ]);
  return <WorkspaceView tasks={(tasks ?? []) as TaskRow[]} notes={(notes ?? []) as NoteRow[]} />;
}
