import type { Metadata } from "next";
import { SettingsView } from "@/features/settings/components/settings-view";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { data } = await db
    .from("Integration")
    .select("id")
    .eq("userId", DEFAULT_USER_ID)
    .eq("provider", "google")
    .eq("status", "active")
    .maybeSingle();
  return (
    <SettingsView
      googleConnected={!!data}
      googleConfigured={!!process.env.GOOGLE_OAUTH_CLIENT_ID}
    />
  );
}
