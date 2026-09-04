import type { Metadata } from "next";
import { MemoryView, type MemoryItem } from "@/features/memory/components/memory-view";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

export const metadata: Metadata = {
  title: "Memory",
  description: "What SAGE remembers about you, and why.",
};
export const dynamic = "force-dynamic";

export default async function MemoryPage() {
  const { data } = await db
    .from("Memory")
    .select("id, type, content, confidence, importance, createdAt, accessCount, lastAccessedAt, sourceType")
    .eq("userId", DEFAULT_USER_ID)
    .is("supersededBy", null)
    .order("createdAt", { ascending: false })
    .limit(500);
  // How many memories have been retired rather than deleted — the trail
  // consolidation leaves behind. Counted, not listed: the page is about what
  // SAGE currently believes.
  const { count: retired } = await db
    .from("Memory")
    .select("id", { count: "exact", head: true })
    .eq("userId", DEFAULT_USER_ID)
    .not("supersededBy", "is", null);

  return <MemoryView memories={(data ?? []) as MemoryItem[]} retired={retired ?? 0} />;
}
