"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, ChevronDown, History, Loader2, Pencil, Play, Plus, Trash2, X, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { staggerContainer, fadeRise } from "@/lib/motion";

export type WhenKind = "task_overdue" | "aqi_above" | "crypto_move" | "low_steps" | "unread_email";

export interface Trigger { type: string; time?: string; when?: WhenKind; threshold?: number }

export interface AutomationItem {
  id: string;
  name: string;
  trigger: Trigger;
  workflow: { directive: string };
  enabled: boolean;
  lastRunAt: string | null;
  lastReport?: string | null;
  lastStatus?: "running" | "done" | "failed" | null;
}

export interface FleetHealth { total: number; enabled: number; runs24h: number; failed24h: number }

interface Run {
  id: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  endedAt: string | null;
  report: string | null;
  error: string | null;
}

const WHEN_LABEL: Record<WhenKind, string> = {
  task_overdue: "A TASK GOES OVERDUE",
  aqi_above: "AQI RISES ABOVE",
  crypto_move: "CRYPTO MOVES OVER",
  low_steps: "STEPS FALL BELOW",
  unread_email: "NEW EMAIL ARRIVES",
};
const THRESHOLD_KINDS: WhenKind[] = ["aqi_above", "crypto_move", "low_steps"];

/** Condition automations have no time, so the old unconditional "DAILY — UTC"
 *  described every one of them wrongly. */
function triggerLabel(t: Trigger): string {
  if (t.type === "condition" && t.when) {
    const base = WHEN_LABEL[t.when] ?? t.when.toUpperCase();
    return THRESHOLD_KINDS.includes(t.when) && t.threshold != null
      ? `WHEN ${base} ${t.threshold}${t.when === "crypto_move" ? "%" : ""}`
      : `WHEN ${base}`;
  }
  return `DAILY ${t.time ?? "—"} UTC`;
}

const stamp = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).toUpperCase();

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

export function AutomationsView({ automations, health }: { automations: AutomationItem[]; health: FleetHealth }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [time, setTime] = useState("03:00");
  const [directive, setDirective] = useState("");
  const [when, setWhen] = useState<"daily" | "task_overdue" | "aqi_above" | "crypto_move" | "low_steps" | "unread_email">("daily");
  const [threshold, setThreshold] = useState(150);
  const [busy, setBusy] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, string>>({});

  // Run history, fetched only when a trail is opened — twenty runs per
  // automation is a lot to load for a page you may only be glancing at.
  const [openRuns, setOpenRuns] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, Run[] | "loading">>({});

  // Inline edit of an existing directive.
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; directive: string; time: string }>({ name: "", directive: "", time: "03:00" });
  const [saving, setSaving] = useState(false);

  const showRuns = async (id: string) => {
    if (openRuns === id) { setOpenRuns(null); return; }
    setOpenRuns(id);
    if (runs[id] && runs[id] !== "loading") return; // already have the trail
    setRuns((r) => ({ ...r, [id]: "loading" }));
    const j = await fetch(`/api/automation/${id}/runs`).then((r) => r.json()).catch(() => null);
    setRuns((r) => ({ ...r, [id]: j?.ok ? (j.data as Run[]) : [] }));
  };

  const startEdit = (a: AutomationItem) => {
    setEditId(a.id);
    setDraft({ name: a.name, directive: a.workflow.directive, time: a.trigger.time ?? "03:00" });
  };

  const saveEdit = async (a: AutomationItem) => {
    if (!draft.name.trim() || !draft.directive.trim() || saving) return;
    setSaving(true);
    // Only the time is editable for a daily trigger; changing the *kind* of
    // trigger is a different automation, so that stays a create.
    const body: Record<string, unknown> = { name: draft.name.trim(), directive: draft.directive.trim() };
    if (a.trigger.type !== "condition") body.trigger = { type: "daily", time: draft.time };
    await fetch(`/api/automation/${a.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    setEditId(null);
    router.refresh();
  };

  const create = async () => {
    if (!name.trim() || !directive.trim() || busy) return;
    setBusy(true);
    const trigger = when === "daily"
      ? { type: "daily" as const, time }
      : { type: "condition" as const, when, ...(["aqi_above", "crypto_move", "low_steps"].includes(when) ? { threshold } : {}) };
    await fetch("/api/automation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim(), directive: directive.trim(), trigger }),
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
            <h1 className="brand-title mt-1 text-[26px] md:text-[32px]">Automations</h1>
            <p className="hud-label mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>{health.enabled}/{health.total} ARMED</span>
              <span>·</span>
              <span>{health.runs24h} RUN{health.runs24h === 1 ? "" : "S"} / 24H</span>
              {health.failed24h > 0 && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1 !text-red-400">
                    <AlertTriangle className="size-3" /> {health.failed24h} FAILED
                  </span>
                </>
              )}
            </p>
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
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="DIRECTIVE NAME"
                    className="h-10 w-full border border-border-glass bg-transparent px-3 font-mono text-sm outline-none placeholder:text-subtle focus:border-border-glass-strong"
                  />
                  {/* WHEN → visual trigger */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="hud-label !text-live">WHEN</span>
                    <select
                      value={when}
                      onChange={(e) => setWhen(e.target.value as typeof when)}
                      className="h-9 border border-border-glass bg-background px-2 font-mono text-xs outline-none focus:border-border-glass-strong"
                    >
                      <option value="daily">every day at…</option>
                      <option value="task_overdue">a task goes overdue</option>
                      <option value="aqi_above">AQI rises above…</option>
                      <option value="crypto_move">crypto moves more than…</option>
                      <option value="low_steps">my steps fall below…</option>
                      <option value="unread_email">a new email arrives</option>
                    </select>
                    {when === "daily" && (
                      <div className="flex items-center gap-2 border border-border-glass px-3 h-9"><span className="hud-label">UTC</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="bg-transparent font-mono text-sm outline-none" /></div>
                    )}
                    {["aqi_above", "crypto_move", "low_steps"].includes(when) && (
                      <div className="flex items-center gap-2 border border-border-glass px-3 h-9">
                        <input type="number" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="w-16 bg-transparent font-mono text-sm outline-none" />
                        <span className="hud-label">{when === "crypto_move" ? "%" : when === "low_steps" ? "STEPS" : "AQI"}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2"><span className="hud-label !text-live">THEN SAGE</span><span className="hud-label">·  FULL TOOL ACCESS</span></div>
                  <textarea
                    value={directive}
                    onChange={(e) => setDirective(e.target.value)}
                    placeholder="…checks my unread email and drafts replies to anything urgent."
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
                  <p className="flex items-center gap-2 font-mono text-sm font-medium">
                    {automation.name}
                    {automation.lastStatus === "failed" && (
                      <span className="hud-label flex items-center gap-1 border border-red-500/40 px-1.5 py-0.5 !text-red-400">
                        <AlertTriangle className="size-2.5" /> FAILING
                      </span>
                    )}
                  </p>
                  <p className="hud-label mt-0.5">
                    {triggerLabel(automation.trigger)} ·{" "}
                    {automation.lastRunAt ? `LAST RUN ${stamp(automation.lastRunAt)}` : "NEVER RUN"}
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
                  onClick={() => showRuns(automation.id)}
                  title="Run history"
                  className={cn(
                    "hud-label flex items-center gap-1.5 border border-border-glass px-3 py-1.5 transition-colors hover:border-border-glass-strong hover:!text-foreground",
                    openRuns === automation.id && "border-border-glass-strong !text-foreground",
                  )}
                >
                  <History className="size-3" />
                  <ChevronDown className={cn("size-3 transition-transform", openRuns === automation.id && "rotate-180")} />
                </button>
                <button
                  onClick={() => (editId === automation.id ? setEditId(null) : startEdit(automation))}
                  title="Edit directive"
                  className="p-1.5 text-subtle transition-colors hover:text-foreground"
                >
                  {editId === automation.id ? <X className="size-4" /> : <Pencil className="size-4" />}
                </button>
                <button
                  onClick={() => remove(automation.id)}
                  title="Delete"
                  className="p-1.5 text-subtle opacity-0 transition-all hover:text-red-400 group-hover:opacity-100"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              {editId === automation.id ? (
                <div className="mt-3 space-y-2 border-l border-border-glass pl-4">
                  <input
                    value={draft.name}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    className="h-9 w-full border border-border-glass bg-transparent px-3 font-mono text-sm outline-none focus:border-border-glass-strong"
                  />
                  <textarea
                    value={draft.directive}
                    onChange={(e) => setDraft((d) => ({ ...d, directive: e.target.value }))}
                    rows={3}
                    className="w-full resize-none border border-border-glass bg-transparent p-3 font-mono text-sm outline-none focus:border-border-glass-strong"
                  />
                  <div className="flex items-center gap-2">
                    {automation.trigger.type !== "condition" && (
                      <div className="flex h-9 items-center gap-2 border border-border-glass px-3">
                        <span className="hud-label">UTC</span>
                        <input
                          type="time"
                          value={draft.time}
                          onChange={(e) => setDraft((d) => ({ ...d, time: e.target.value }))}
                          className="bg-transparent font-mono text-sm outline-none"
                        />
                      </div>
                    )}
                    <button
                      onClick={() => saveEdit(automation)}
                      disabled={saving || !draft.name.trim() || !draft.directive.trim()}
                      className="hud-label flex items-center gap-2 bg-foreground px-4 py-2 !text-background transition-opacity disabled:opacity-30"
                    >
                      {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} SAVE
                    </button>
                    <button onClick={() => setEditId(null)} className="hud-label px-3 py-2 hover:!text-foreground">
                      CANCEL
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-3 border-l border-border-glass pl-4 text-sm text-muted">
                  {automation.workflow.directive}
                </p>
              )}

              {openRuns === automation.id && (
                <div className="mt-3 border border-border-glass">
                  {runs[automation.id] === "loading" && (
                    <p className="flex items-center gap-2 p-3 text-sm text-subtle">
                      <Loader2 className="size-3 animate-spin" /> Loading history…
                    </p>
                  )}
                  {Array.isArray(runs[automation.id]) && (runs[automation.id] as Run[]).length === 0 && (
                    <p className="p-3 text-sm text-subtle">No runs recorded yet.</p>
                  )}
                  {Array.isArray(runs[automation.id]) &&
                    (runs[automation.id] as Run[]).map((r) => (
                      <div key={r.id} className="border-b border-border-glass p-3 last:border-b-0">
                        <p className="hud-label flex items-center gap-2">
                          <span
                            className={cn(
                              "size-1.5 rounded-full",
                              r.status === "failed" ? "bg-red-400" : r.status === "running" ? "bg-subtle" : "bg-[var(--live)]",
                            )}
                          />
                          <span className={cn(r.status === "failed" && "!text-red-400")}>{r.status.toUpperCase()}</span>
                          <span>·</span>
                          <span>{stamp(r.startedAt)}</span>
                        </p>
                        {(r.report ?? r.error) && (
                          <p className={cn("mt-1.5 text-sm", r.error ? "text-red-300" : "text-muted")}>
                            {r.error ?? r.report}
                          </p>
                        )}
                      </div>
                    ))}
                </div>
              )}
              {/* The trail already leads with this run, so showing it twice is
                  just noise while the history is open. */}
              {openRuns !== automation.id && (reports[automation.id] ?? automation.lastReport) && (
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
