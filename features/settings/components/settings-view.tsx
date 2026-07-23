"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { CalendarDays, Check, CheckCircle2, Mail, Music } from "lucide-react";
import { staggerContainer, fadeRise } from "@/lib/motion";
import { GlassPanel } from "@/components/ui/glass-panel";
import { APP_NAME } from "@/lib/config";

function ConnectedBadge({ provider, onDone }: { provider: string; onDone: () => void }) {
  const disconnect = async () => {
    await fetch("/api/integrations/disconnect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    onDone();
  };
  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-1.5 border border-border-glass bg-glass-strong px-3 py-1 text-xs text-live">
        <Check className="size-3.5" /> Connected
      </span>
      <button
        onClick={disconnect}
        className="border border-border-glass px-3 py-1 text-xs text-muted transition-colors hover:border-border-glass-strong hover:text-foreground"
      >
        Disconnect
      </button>
    </div>
  );
}

export function SettingsView({
  googleConnected,
  googleConfigured,
  spotifyConnected,
  spotifyConfigured,
  ticktickConnected = false,
  ticktickConfigured = false,
}: {
  googleConnected: boolean;
  googleConfigured: boolean;
  spotifyConnected: boolean;
  spotifyConfigured: boolean;
  ticktickConnected?: boolean;
  ticktickConfigured?: boolean;
}) {
  const router = useRouter();
  const refresh = () => router.refresh();
  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <motion.div variants={staggerContainer} initial="hidden" animate="visible">
        <motion.h1 variants={fadeRise} className="text-2xl font-semibold tracking-tight">
          Settings
        </motion.h1>
        <motion.p variants={fadeRise} className="mt-1 text-sm text-muted">
          Integrations and preferences.
        </motion.p>

        <motion.div variants={fadeRise} className="mt-8">
          <h2 className="text-sm font-medium text-muted">Integrations</h2>
          <GlassPanel className="mt-3 flex items-center gap-4 p-5">
            <div className="flex gap-1.5">
              <CalendarDays className="size-5 text-muted" />
              <Mail className="size-5 text-muted" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">Google Calendar &amp; Gmail</p>
              <p className="text-xs text-subtle">
                Lets {APP_NAME} see your schedule and unread email (read-only).
              </p>
            </div>
            {googleConnected ? (
              <ConnectedBadge provider="google" onDone={refresh} />
            ) : googleConfigured ? (
              <a href="/api/integrations/google" className="bg-accent px-3.5 py-1.5 text-xs font-medium text-background">
                Connect
              </a>
            ) : (
              <span className="text-xs text-subtle">Set GOOGLE_OAUTH_CLIENT_ID/SECRET to enable</span>
            )}
          </GlassPanel>

          <GlassPanel className="mt-3 flex items-center gap-4 p-5">
            <Music className="size-5 text-muted" />
            <div className="flex-1">
              <p className="text-sm font-medium">Spotify</p>
              <p className="text-xs text-subtle">
                Now-playing panel + voice control (&quot;play my focus playlist&quot;).
              </p>
            </div>
            {spotifyConnected ? (
              <ConnectedBadge provider="spotify" onDone={refresh} />
            ) : spotifyConfigured ? (
              <a href="/api/integrations/spotify" className="bg-accent px-3.5 py-1.5 text-xs font-medium text-background">
                Connect
              </a>
            ) : (
              <span className="text-xs text-subtle">Set SPOTIFY_CLIENT_ID/SECRET</span>
            )}
          </GlassPanel>

          <GlassPanel className="mt-3 flex items-center gap-4 p-5">
            <CheckCircle2 className="size-5 text-muted" />
            <div className="flex-1">
              <p className="text-sm font-medium">TickTick</p>
              <p className="text-xs text-subtle">
                Your TickTick tasks &amp; deadlines flow into the Deadlines panel.
              </p>
            </div>
            {ticktickConnected ? (
              <ConnectedBadge provider="ticktick" onDone={refresh} />
            ) : ticktickConfigured ? (
              <a href="/api/integrations/ticktick" className="bg-accent px-3.5 py-1.5 text-xs font-medium text-background">
                Connect
              </a>
            ) : (
              <span className="text-xs text-subtle">Set TICKTICK_CLIENT_ID/SECRET</span>
            )}
          </GlassPanel>
        </motion.div>
      </motion.div>
    </div>
  );
}
