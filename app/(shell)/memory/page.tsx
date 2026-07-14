import type { Metadata } from "next";
import { MemoryView, type MemoryItem } from "@/features/memory/components/memory-view";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

export const metadata: Metadata = { title: "Memory" };
export const dynamic = "force-dynamic";

export default async function MemoryPage() {
  const { data } = await db
    .from("Memory")
    .select("id, type, content, confidence, importance, createdAt")
    .eq("userId", DEFAULT_USER_ID)
    .is("supersededBy", null)
    .order("createdAt", { ascending: false })
    .limit(500);
  return <MemoryView memories={(data ?? []) as MemoryItem[]} />;
}
