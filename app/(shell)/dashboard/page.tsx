import type { Metadata } from "next";
import { DashboardView } from "@/features/dashboard/components/dashboard-view";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { data } = await db
    .from("Task")
    .select("id, title, status, dueAt")
    .eq("userId", DEFAULT_USER_ID)
    .in("status", ["todo", "doing"])
    .order("dueAt", { ascending: true, nullsFirst: false })
    .limit(5);
  return <DashboardView tasks={data ?? []} />;
}
