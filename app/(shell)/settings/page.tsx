import type { Metadata } from "next";
import { SettingsView } from "@/features/settings/components/settings-view";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

async function connected(provider: string): Promise<boolean> {
  const { data } = await db
    .from("Integration")
    .select("id")
    .eq("userId", DEFAULT_USER_ID)
    .eq("provider", provider)
    .eq("status", "active")
    .maybeSingle();
  return !!data;
}

export default async function SettingsPage() {
  const [google, spotify, ticktick] = await Promise.all([connected("google"), connected("spotify"), connected("ticktick")]);
  return (
    <SettingsView
      googleConnected={google}
      googleConfigured={!!process.env.GOOGLE_OAUTH_CLIENT_ID}
      spotifyConnected={spotify}
      spotifyConfigured={!!process.env.SPOTIFY_CLIENT_ID}
      ticktickConnected={ticktick}
      ticktickConfigured={!!process.env.TICKTICK_CLIENT_ID}
    />
  );
}
