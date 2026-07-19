"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Play, Plus, Trash2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { staggerContainer, fadeRise } from "@/lib/motion";

export interface AutomationItem {
  id: string;
  name: string;
  trigger: { type: string; time?: string };
  workflow: { directive: string };
  enabled: boolean;
  lastRunAt: string | null;
  lastReport?: string | null;
}

const PRESETS = [
  {
    name: "Morning briefing note",
    time: "03:00",
    directive:
      "Review my open tasks, pending reminders, calendar and unread email. Write a short 'Daily Briefing' note in my workspace summarizing what matters today and any suggested priorities.",
  },
  {
    name: "Inbox triage",
    time: "03:00",
    directive:
      "Check my unread emails. For any that clearly require an action from me, create a task with a sensible title. Report what you created.",
  },
  {
    name: "Weekly learning digest",
    time: "03:00",
    directive:
      "Search the web for the most significant AI and software engineering news from the past day. Save a short digest note titled with today's date.",
  },
];

export function AutomationsView({ automations }: { automations: AutomationItem[] }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [time, setTime] = useState("03:00");
  const [directive, setDirective] = useState("");
  const [busy, setBusy] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, string>>({});

  const create = async () => {
    if (!name.trim() || !directive.trim() || busy) return;
    setBusy(true);
    await fetch("/api/automation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim(), time, directive: directive.trim() }),
    });
    setBusy(false);
    setShowForm(false);
    setName("");
    setDirective("");
    router.refresh();
  };

  const toggle = async (automation: AutomationItem) => {
    await fetch(`/api/automation/${automation.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !automation.enabled }),
    });
    router.refresh();
  };

  const remove = async (id: string) => {
    await fetch(`/api/automation/${id}`, { method: "DELETE" });
    router.refresh();
  };

  const runNow = async (id: string) => {
    setRunningId(id);
    try {
      const res = await fetch(`/api/automation/${id}`, { method: "POST" });
      const json = await res.json();
      setReports((r) => ({ ...r, [id]: json.ok ? json.data.report : `FAILED: ${json.error}` }));
    } finally {
      setRunningId(null);
      router.refresh();
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <motion.div variants={staggerContainer} initial="hidden" animate="visible">
        <motion.div variants={fadeRise} className="flex items-baseline justify-between">
          <div>
            <p className="hud-label">AUTONOMOUS DIRECTIVES</p>
            <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight">Automations</h1>
          </div>
          <button
            onClick={() => setShowForm((s) => !s)}
            className="hud-label flex items-center gap-2 border border-border-glass px-4 py-2 transition-colors hover:border-border-glass-strong hover:!text-foreground"
          >
            <Plus className="size-3.5" /> NEW DIRECTIVE
          </button>
        </motion.div>

        <AnimatePresence>
          {showForm && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="mono-grid mt-5 grid-cols-1">
                <div className="space-y-4 p-5">
                  <div className="flex flex-wrap gap-2">
                    {PRESETS.map((preset) => (
                      <button
                        key={preset.name}
                        onClick={() => {
                          setName(preset.name);
                          setTime(preset.time);
                          setDirective(preset.directive);
                        }}
                        className="hud-label border border-border-glass px-3 py-1.5 transition-colors hover:border-border-glass-strong hover:!text-foreground"
                      >
                        {preset.name.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-3">
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="DIRECTIVE NAME"
                      className="h-10 flex-1 border border-border-glass bg-transparent px-3 font-mono text-sm outline-none placeholder:text-subtle focus:border-border-glass-strong"
                    />
                    <div className="flex items-center gap-2 border border-border-glass px-3">
                      <span className="hud-label">DAILY · UTC</span>
                      <input
                        type="time"
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                        className="bg-transparent font-mono text-sm outline-none"
                      />
                    </div>
                  </div>
                  <textarea
                    value={directive}
                    onChange={(e) => setDirective(e.target.value)}
                    placeholder="WHAT SHOULD SAGE DO? IT HAS FULL TOOL ACCESS: TASKS, NOTES, MEMORY, WEB SEARCH, CALENDAR, EMAIL…"
                    rows={3}
                    className="w-full resize-none border border-border-glass bg-transparent p-3 font-mono text-sm outline-none placeholder:text-subtle focus:border-border-glass-strong"
                  />
                  <button
                    onClick={create}
                    disabled={busy || !name.trim() || !directive.trim()}
                    className="hud-label flex items-center gap-2 bg-foreground px-5 py-2.5 !text-background transition-opacity disabled:opacity-30"
                  >
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
                    DEPLOY DIRECTIVE
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div variants={fadeRise} className="mono-grid mt-5 grid-cols-1">
          {automations.length === 0 && (
            <p className="p-10 text-center text-sm text-subtle">
              NO DIRECTIVES DEPLOYED. SAGE AWAITS ORDERS.
            </p>
          )}
          {automations.map((automation) => (
            <div key={automation.id} className="group p-5">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => toggle(automation)}
                  title={automation.enabled ? "Disable" : "Enable"}
                  className={cn(
                    "relative h-5 w-9 border transition-colors",
                    automation.enabled ? "border-foreground bg-foreground" : "border-border-glass",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 size-3.5 transition-all",
                      automation.enabled ? "left-[18px] bg-background" : "left-0.5 bg-subtle",
                    )}
                  />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm font-medium">{automation.name}</p>
                  <p className="hud-label mt-0.5">
                    DAILY {automation.trigger.time ?? "—"} UTC ·{" "}
                    {automation.lastRunAt
                      ? `LAST RUN ${new Date(automation.lastRunAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).toUpperCase()}`
                      : "NEVER RUN"}
                  </p>
                </div>
                <button
                  onClick={() => runNow(automation.id)}
                  disabled={runningId === automation.id}
                  title="Run now"
                  className="hud-label flex items-center gap-1.5 border border-border-glass px-3 py-1.5 transition-colors hover:border-border-glass-strong hover:!text-foreground"
                >
                  {runningId === automation.id ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Play className="size-3" />
                  )}
                  RUN
                </button>
                <button
                  onClick={() => remove(automation.id)}
                  title="Delete"
                  className="p-1.5 text-subtle opacity-0 transition-all hover:text-red-400 group-hover:opacity-100"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              <p className="mt-3 border-l border-border-glass pl-4 text-sm text-muted">
                {automation.workflow.directive}
              </p>
              {(reports[automation.id] ?? automation.lastReport) && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="mt-3 border border-border-glass bg-glass p-3 text-sm"
                >
                  <span className="hud-label block">LAST REPORT</span>
                  <span className="mt-1 block text-muted">
                    {reports[automation.id] ?? automation.lastReport}
                  </span>
                </motion.p>
              )}
            </div>
          ))}
        </motion.div>
      </motion.div>
    </div>
  );
}
