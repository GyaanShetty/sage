import type { Metadata } from "next";
import { KnowledgeView, type SourceItem } from "@/features/knowledge/components/knowledge-view";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

export const metadata: Metadata = { title: "Knowledge" };
export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const { data } = await db
    .from("Source")
    .select("id, kind, title, url, status, createdAt, metadata")
    .eq("userId", DEFAULT_USER_ID)
    .order("createdAt", { ascending: false })
    .limit(100);
  return <KnowledgeView sources={(data ?? []) as SourceItem[]} />;
}
