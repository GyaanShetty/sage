"use client";

import { motion } from "framer-motion";
import { CalendarDays, Check, Mail } from "lucide-react";
import { staggerContainer, fadeRise } from "@/lib/motion";
import { GlassPanel } from "@/components/ui/glass-panel";
import { APP_NAME } from "@/lib/config";

export function SettingsView({
  googleConnected,
  googleConfigured,
}: {
  googleConnected: boolean;
  googleConfigured: boolean;
}) {
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
              <span className="flex items-center gap-1.5 rounded-full border border-border-glass bg-glass-strong px-3 py-1 text-xs text-accent">
                <Check className="size-3.5" /> Connected
              </span>
            ) : googleConfigured ? (
              <a
                href="/api/integrations/google"
                className="rounded-lg bg-accent px-3.5 py-1.5 text-xs font-medium text-white shadow-[0_0_16px_var(--accent-glow)]"
              >
                Connect
              </a>
            ) : (
              <span className="text-xs text-subtle">
                Set GOOGLE_OAUTH_CLIENT_ID/SECRET to enable
              </span>
            )}
          </GlassPanel>
        </motion.div>
      </motion.div>
    </div>
  );
}
