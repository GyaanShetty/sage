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

/** Segmented meter bar (AXION battery style). */
function Meter({ label, value, max, suffix }: { label: string; value: number; max: number; suffix: string }) {
  const SEGMENTS = 36;
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

function nextEventLine(events: EventRow[] | null): { big: string; small: string } {
  if (!events || events.length === 0) return { big: "ALL CLEAR", small: "NO UPCOMING EVENTS ON YOUR CALENDAR" };
  const next = events[0];
  const ms = new Date(next.start).getTime() - Date.now();
  const hours = Math.max(0, Math.floor(ms / 3_600_000));
  const days = Math.floor(hours / 24);
  const big = days > 0 ? `${days} DAY${days > 1 ? "S" : ""}` : `${Math.max(1, hours)} HOURS`;
  return { big, small: `UNTIL ${next.summary.toUpperCase()}` };
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
}: {
  tasks: TaskRow[];
  reminders: ReminderRow[];
  events: EventRow[] | null;
  emails: EmailRow[] | null;
}) {
  const countdown = nextEventLine(events);

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <motion.div variants={staggerContainer} initial="hidden" animate="visible">
        <motion.div variants={fadeRise} className="mono-grid grid-cols-1 lg:grid-cols-3">
          {/* focus banner */}
          <div className="p-6 lg:col-span-2">
            <p className="font-mono text-2xl font-semibold tracking-tight">{countdown.big}</p>
            <p className="hud-label mt-1">{countdown.small}</p>
          </div>
          <div className="p-6">
            <p className="hud-label">Assistant Brief</p>
            <div className="-mt-4">
              <BriefHeader />
            </div>
          </div>

          {/* meters row */}
          <Meter label="OPEN TASKS" value={tasks.length} max={12} suffix="ACTIVE" />
          <Meter label="REMINDERS" value={reminders.length} max={8} suffix="PENDING" />
          <Meter label="UNREAD COMMS" value={emails?.length ?? 0} max={10} suffix="MESSAGES" />

          {/* schedule */}
          <div className="p-5 lg:col-span-2">
            <div className="flex items-baseline justify-between">
              <p className="hud-label !text-foreground">SCHEDULE</p>
              <span className="hud-label">{events ? "LIVE" : "OFFLINE"}</span>
            </div>
            {events === null ? (
              <p className="mt-3 text-sm text-subtle">
                <Link href="/settings" className="underline underline-offset-4">
                  CONNECT GOOGLE
                </Link>{" "}
                TO BRING YOUR CALENDAR ONLINE
              </p>
            ) : events.length === 0 ? (
              <p className="mt-3 text-sm text-subtle">NO UPCOMING EVENTS</p>
            ) : (
              <ul className="mt-3 divide-y divide-border-glass">
                {events.map((event, i) => (
                  <li key={i} className="flex items-baseline gap-4 py-2 text-sm">
                    <span className="hud-label w-28 shrink-0 tabular-nums">
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

          {/* comms */}
          <div className="p-5">
            <div className="flex items-baseline justify-between">
              <p className="hud-label !text-foreground">COMMS</p>
              <span className="hud-label">{emails ? `${emails.length} UNREAD` : "OFFLINE"}</span>
            </div>
            {emails === null ? (
              <p className="mt-3 text-sm text-subtle">
                <Link href="/settings" className="underline underline-offset-4">
                  CONNECT GOOGLE
                </Link>
              </p>
            ) : emails.length === 0 ? (
              <p className="mt-3 text-sm text-subtle">INBOX ZERO</p>
            ) : (
              <ul className="mt-3 divide-y divide-border-glass">
                {emails.map((email, i) => (
                  <li key={i} className="py-2 text-sm">
                    <p className="hud-label">{email.from.replace(/<.*>/, "").trim().toUpperCase()}</p>
                    <p className="mt-0.5 truncate text-muted">{email.subject}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* tasks */}
          <div className="p-5 lg:col-span-2">
            <div className="flex items-baseline justify-between">
              <p className="hud-label !text-foreground">TASKS</p>
              <Link href="/workspace" className="hud-label flex items-center gap-1 hover:!text-foreground">
                SHOW ALL <ArrowUpRight className="size-3" />
              </Link>
            </div>
            {tasks.length === 0 ? (
              <p className="mt-3 text-sm text-subtle">NOTHING OPEN — ASK SAGE TO ADD ONE</p>
            ) : (
              <ul className="mt-3 divide-y divide-border-glass">
                {tasks.slice(0, 4).map((task, i) => (
                  <li key={task.id} className="flex items-baseline gap-4 py-2 text-sm">
                    <span className="hud-label w-8 shrink-0">{String(i + 1).padStart(2, "0")}</span>
                    <span className="truncate">{task.title}</span>
                    {task.dueAt && (
                      <span className="hud-label ml-auto shrink-0">
                        {new Date(task.dueAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase()}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* reminders */}
          <div className="p-5">
            <p className="hud-label !text-foreground">REMINDERS</p>
            {reminders.length === 0 ? (
              <p className="mt-3 text-sm text-subtle">NONE PENDING</p>
            ) : (
              <ul className="mt-3 divide-y divide-border-glass">
                {reminders.slice(0, 4).map((reminder) => (
                  <li key={reminder.id} className="py-2 text-sm">
                    <p className="hud-label tabular-nums">
                      {new Date(reminder.remindAt)
                        .toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
                        .toUpperCase()}
                    </p>
                    <p className="mt-0.5 truncate text-muted">{reminder.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </motion.div>

        {/* quick-action tiles */}
        <motion.div variants={fadeRise} className="mono-grid mt-6 grid-cols-3 lg:grid-cols-6">
          {QUICK.map(({ href, label, icon: Icon }) => (
            <Link
              key={label}
              href={href}
              className="group flex flex-col items-center gap-3 py-7 transition-colors hover:bg-glass-strong"
            >
              <Icon className="size-5 text-muted transition-colors group-hover:text-foreground" strokeWidth={1.5} />
              <span className="hud-label transition-colors group-hover:!text-foreground">{label}</span>
            </Link>
          ))}
        </motion.div>

        <motion.p variants={fadeRise} className="hud-label mt-6 text-center !text-subtle">
          ⌘K COMMAND · MIC ORB FOR VOICE
        </motion.p>
      </motion.div>
    </div>
  );
}
