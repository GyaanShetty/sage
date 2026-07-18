"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowUpRight,
  BookOpen,
  Brain,
  ListTodo,
  MessageSquare,
  Mic,
  Zap,
} from "lucide-react";
import { staggerContainer, fadeRise } from "@/lib/motion";
import { BriefHeader } from "./brief-header";
import { SageCore, type CoreData } from "./sage-core";

interface TaskRow {
  id: string;
  title: string;
  status: string;
  dueAt: string | null;
}
interface ReminderRow {
  id: string;
  text: string;
  remindAt: string;
}
interface EventRow {
  summary: string;
  start: string;
}
interface EmailRow {
  from: string;
  subject: string;
}
interface Stats {
  memories: number;
  sources: number;
  runs: number;
}
interface LogRow {
  type: string;
  createdAt: string;
}

const LOG_LABEL: Record<string, string> = {
  "memory.extracted": "MEMORY COMMITTED",
  "brief.generated": "BRIEF COMPILED",
  "reminder.fired": "REMINDER FIRED",
  "run.finished": "AGENT RUN COMPLETE",
};

/** Segmented meter bar. */
function Meter({ label, value, max, suffix }: { label: string; value: number; max: number; suffix: string }) {
  const SEGMENTS = 30;
  const filled = Math.round(Math.min(value / max, 1) * SEGMENTS);
  return (
    <div className="p-5">
      <p className="hud-label">
        {label} — ({value} {suffix})
      </p>
      <div className="mt-3 flex gap-[3px]">
        {Array.from({ length: SEGMENTS }).map((_, i) => (
          <motion.span
            key={i}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: i * 0.012 }}
            className={i < filled ? "h-4 w-1.5 bg-foreground" : "h-4 w-1.5 bg-glass-strong"}
          />
        ))}
      </div>
    </div>
  );
}

/** Horizontal 24h timeline with event ticks and now-marker. */
function DayTimeline({ events }: { events: EventRow[] | null }) {
  const now = new Date();
  const nowPct = ((now.getHours() + now.getMinutes() / 60) / 24) * 100;
  const todays = (events ?? []).filter((e) => {
    const d = new Date(e.start);
    return d.toDateString() === now.toDateString();
  });
  return (
    <div className="p-5">
      <div className="flex items-baseline justify-between">
        <p className="hud-label !text-foreground">DAY TIMELINE</p>
        <p className="hud-label">{todays.length} EVENTS TODAY</p>
      </div>
      <div className="relative mt-4 h-8">
        {/* hour ruler */}
        <div className="absolute inset-x-0 top-1/2 h-px bg-border-glass" />
        {Array.from({ length: 25 }).map((_, h) => (
          <span
            key={h}
            className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-border-glass"
            style={{ left: `${(h / 24) * 100}%`, height: h % 6 === 0 ? 12 : 6 }}
          />
        ))}
        {/* events */}
        {todays.map((e, i) => {
          const d = new Date(e.start);
          const pct = ((d.getHours() + d.getMinutes() / 60) / 24) * 100;
          return (
            <span
              key={i}
              title={e.summary}
              className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-foreground"
              style={{ left: `${pct}%` }}
            />
          );
        })}
        {/* now */}
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="absolute top-0 h-full w-px bg-foreground"
          style={{ left: `${nowPct}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between">
        {["00", "06", "12", "18", "24"].map((h) => (
          <span key={h} className="hud-label !text-subtle">
            {h}
          </span>
        ))}
      </div>
    </div>
  );
}

const QUICK = [
  { href: "/chat", label: "CHAT", icon: MessageSquare },
  { href: "/workspace", label: "TASKS", icon: ListTodo },
  { href: "/knowledge", label: "KNOWLEDGE", icon: BookOpen },
  { href: "/memory", label: "MEMORY", icon: Brain },
  { href: "/automations", label: "AUTOMATIONS", icon: Zap },
  { href: "/chat", label: "VOICE", icon: Mic },
];

export function DashboardView({
  tasks,
  reminders,
  events,
  emails,
  stats,
  log,
}: {
  tasks: TaskRow[];
  reminders: ReminderRow[];
  events: EventRow[] | null;
  emails: EmailRow[] | null;
  stats: Stats;
  log: LogRow[];
}) {
  const now = new Date();
  const focus = tasks[0]?.title ?? "NO OPEN TASKS — ALL CLEAR";
  const coreData: CoreData = {
    eventHours: (events ?? [])
      .filter((e) => new Date(e.start).toDateString() === now.toDateString())
      .map((e) => {
        const d = new Date(e.start);
        return d.getHours() + d.getMinutes() / 60;
      }),
    load: Math.min(tasks.length / 10, 1),
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <motion.div variants={staggerContainer} initial="hidden" animate="visible">
        <motion.div variants={fadeRise} className="mono-grid grid-cols-1 lg:grid-cols-3">
          {/* focus banner */}
          <div className="p-6 lg:col-span-2">
            <p className="hud-label">
              {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }).toUpperCase()}
            </p>
            <p className="mt-2 font-mono text-2xl font-semibold tracking-tight">{focus}</p>
            <p className="hud-label mt-1">PRIMARY FOCUS · {tasks.length} OPEN / {reminders.length} PENDING</p>
          </div>
          <div className="p-6">
            <p className="hud-label">Assistant Brief</p>
            <div className="-mt-4">
              <BriefHeader />
            </div>
          </div>

          {/* THE CORE — center stage */}
          <div className="relative flex flex-col items-center justify-center py-6 lg:col-span-2 lg:row-span-3">
            <button
              onClick={() => window.dispatchEvent(new Event("sage:engage-voice"))}
              title="Talk to SAGE"
              className="group relative transition-transform hover:scale-[1.02] active:scale-[0.99]"
            >
              <SageCore size={400} data={coreData} />
              <span className="hud-label pointer-events-none absolute inset-x-0 bottom-2 text-center opacity-0 transition-opacity group-hover:opacity-100">
                TAP TO SPEAK
              </span>
            </button>
            <p className="hud-label absolute left-5 top-4">CORE</p>
            <p className="hud-label absolute right-5 top-4">
              DIAL·24H — LOAD {Math.round(coreData.load * 100)}%
            </p>
            <p className="hud-label absolute bottom-4 left-5">◆ EVENT MARKS</p>
            <p className="hud-label absolute bottom-4 right-5">RING·TASK LOAD</p>
          </div>

          {/* right rail: meters + intelligence + log */}
          <div className="flex flex-col divide-y divide-border-glass lg:row-span-3">
            <Meter label="OPEN TASKS" value={tasks.length} max={12} suffix="ACTIVE" />
            <Meter label="UNREAD COMMS" value={emails?.length ?? 0} max={10} suffix="MSG" />
            <div className="grid grid-cols-3 divide-x divide-border-glass">
              {[
                { label: "MEMORIES", value: stats.memories },
                { label: "SOURCES", value: stats.sources },
                { label: "RUNS", value: stats.runs },
              ].map((s) => (
                <div key={s.label} className="p-4 text-center">
                  <p className="font-mono text-2xl font-semibold tabular-nums">{s.value}</p>
                  <p className="hud-label mt-1">{s.label}</p>
                </div>
              ))}
            </div>
            {/* system log */}
            <div className="flex-1 p-5">
              <p className="hud-label !text-foreground">SYSTEM LOG</p>
              <ul className="mt-3 space-y-1.5">
                {log.length === 0 && <li className="hud-label !text-subtle">NO ACTIVITY YET</li>}
                {log.map((row, i) => (
                  <motion.li
                    key={i}
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="flex items-baseline gap-3"
                  >
                    <span className="hud-label !text-subtle tabular-nums">
                      {new Date(row.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className="hud-label">{LOG_LABEL[row.type] ?? row.type.toUpperCase()}</span>
                  </motion.li>
                ))}
              </ul>
            </div>
          </div>

          {/* day timeline spanning under the core */}
          <div className="lg:col-span-3">
            <DayTimeline events={events} />
          </div>

          {/* schedule */}
          <div className="p-5">
            <div className="flex items-baseline justify-between">
              <p className="hud-label !text-foreground">SCHEDULE</p>
              <span className="hud-label">{events ? "LIVE" : "OFFLINE"}</span>
            </div>
            {events === null ? (
              <p className="mt-3 text-sm text-subtle">
                <Link href="/settings" className="underline underline-offset-4">
                  CONNECT GOOGLE
                </Link>
              </p>
            ) : events.length === 0 ? (
              <p className="mt-3 text-sm text-subtle">NO UPCOMING EVENTS</p>
            ) : (
              <ul className="mt-3 divide-y divide-border-glass">
                {events.slice(0, 4).map((event, i) => (
                  <li key={i} className="flex items-baseline gap-4 py-2 text-sm">
                    <span className="hud-label w-24 shrink-0 tabular-nums">
                      {new Date(event.start)
                        .toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })
                        .toUpperCase()}
                    </span>
                    <span className="truncate">{event.summary}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* tasks */}
          <div className="p-5">
            <div className="flex items-baseline justify-between">
              <p className="hud-label !text-foreground">TASKS</p>
              <Link href="/workspace" className="hud-label flex items-center gap-1 hover:!text-foreground">
                ALL <ArrowUpRight className="size-3" />
              </Link>
            </div>
            {tasks.length === 0 ? (
              <p className="mt-3 text-sm text-subtle">NOTHING OPEN</p>
            ) : (
              <ul className="mt-3 divide-y divide-border-glass">
                {tasks.slice(0, 4).map((task, i) => (
                  <li key={task.id} className="flex items-baseline gap-4 py-2 text-sm">
                    <span className="hud-label w-8 shrink-0">{String(i + 1).padStart(2, "0")}</span>
                    <span className="truncate">{task.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* comms + reminders */}
          <div className="flex flex-col divide-y divide-border-glass">
            <div className="p-5">
              <div className="flex items-baseline justify-between">
                <p className="hud-label !text-foreground">COMMS</p>
                <span className="hud-label">{emails ? `${emails.length} UNREAD` : "OFFLINE"}</span>
              </div>
              {emails && emails.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {emails.slice(0, 2).map((email, i) => (
                    <li key={i} className="text-sm">
                      <p className="hud-label">{email.from.replace(/<.*>/, "").trim().toUpperCase()}</p>
                      <p className="mt-0.5 truncate text-muted">{email.subject}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-subtle">{emails ? "INBOX ZERO" : "—"}</p>
              )}
            </div>
            <div className="p-5">
              <p className="hud-label !text-foreground">REMINDERS</p>
              {reminders.length === 0 ? (
                <p className="mt-2 text-sm text-subtle">NONE PENDING</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {reminders.slice(0, 2).map((reminder) => (
                    <li key={reminder.id} className="truncate text-sm text-muted">
                      <span className="hud-label tabular-nums">
                        {new Date(reminder.remindAt)
                          .toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" })
                          .toUpperCase()}
                      </span>{" "}
                      — {reminder.text}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </motion.div>

        {/* quick-action tiles */}
        <motion.div variants={fadeRise} className="mono-grid mt-6 grid-cols-3 lg:grid-cols-6">
          {QUICK.map(({ href, label, icon: Icon }) => (
            <Link
              key={label}
              href={href}
              className="group flex flex-col items-center gap-3 py-6 transition-colors hover:bg-glass-strong"
            >
              <Icon className="size-5 text-muted transition-colors group-hover:text-foreground" strokeWidth={1.5} />
              <span className="hud-label transition-colors group-hover:!text-foreground">{label}</span>
            </Link>
          ))}
        </motion.div>
      </motion.div>
    </div>
  );
}
