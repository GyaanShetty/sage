"use client";

import { motion } from "framer-motion";
import { staggerContainer, fadeRise } from "@/lib/motion";
import { GlassPanel } from "@/components/ui/glass-panel";
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

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "GOOD NIGHT";
  if (h < 12) return "GOOD MORNING";
  if (h < 18) return "GOOD AFTERNOON";
  return "GOOD EVENING";
}

function Stat({ label, value, live }: { label: string; value: number | string; live?: boolean }) {
  return (
    <GlassPanel className="flex-1 p-4">
      <p className="hud-label">{label}</p>
      <p className="mt-1 font-mono text-3xl font-semibold tabular-nums tracking-tight">
        {value}
        {live && (
          <span className="ml-2 inline-block size-1.5 -translate-y-1 animate-pulse rounded-full bg-accent shadow-[0_0_8px_var(--accent-glow)]" />
        )}
      </p>
    </GlassPanel>
  );
}

function PanelHeader({ children, tone }: { children: React.ReactNode; tone?: "accent" | "warn" }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={
          tone === "warn"
            ? "size-1.5 rounded-full bg-warn"
            : tone === "accent"
              ? "size-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--accent-glow)]"
              : "size-1.5 rounded-full bg-subtle"
        }
      />
      <h2 className="hud-label !text-foreground">{children}</h2>
    </div>
  );
}

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
  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <motion.div variants={staggerContainer} initial="hidden" animate="visible">
        <motion.p variants={fadeRise} className="hud-label !text-accent">
          {greeting()} · OPERATOR
        </motion.p>
        <motion.h1 variants={fadeRise} className="mt-1 text-2xl font-semibold tracking-tight">
          Command Center
        </motion.h1>

        <motion.div variants={fadeRise}>
          <BriefHeader />
        </motion.div>

        {/* stat strip */}
        <motion.div variants={fadeRise} className="mt-5 flex flex-col gap-3 sm:flex-row">
          <Stat label="Open Tasks" value={tasks.length} />
          <Stat label="Reminders" value={reminders.length} />
          <Stat label="Events" value={events ? events.length : "—"} live={!!events} />
          <Stat label="Unread" value={emails ? emails.length : "—"} live={!!emails} />
        </motion.div>

        <motion.div
          variants={staggerContainer}
          className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2"
        >
          <motion.div variants={fadeRise} whileHover={{ y: -2 }}>
            <GlassPanel className="min-h-40 p-5 transition-colors hover:border-border-glass-strong">
              <PanelHeader tone="accent">Schedule</PanelHeader>
              {events === null ? (
                <p className="mt-3 text-sm text-subtle">
                  <a href="/settings" className="text-accent underline-offset-2 hover:underline">
                    Connect Google
                  </a>{" "}
                  to bring your calendar online.
                </p>
              ) : events.length === 0 ? (
                <p className="mt-3 text-sm text-subtle">No upcoming events. Clear skies.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {events.map((event, i) => (
                    <li key={i} className="flex items-baseline gap-3 text-sm">
                      <span className="hud-label w-24 shrink-0 tabular-nums">
                        {new Date(event.start).toLocaleString(undefined, {
                          weekday: "short",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                      <span className="truncate text-muted">{event.summary}</span>
                    </li>
                  ))}
                </ul>
              )}
            </GlassPanel>
          </motion.div>

          <motion.div variants={fadeRise} whileHover={{ y: -2 }}>
            <GlassPanel className="min-h-40 p-5 transition-colors hover:border-border-glass-strong">
              <PanelHeader tone="accent">Comms · Unread</PanelHeader>
              {emails === null ? (
                <p className="mt-3 text-sm text-subtle">
                  <a href="/settings" className="text-accent underline-offset-2 hover:underline">
                    Connect Google
                  </a>{" "}
                  to monitor your inbox.
                </p>
              ) : emails.length === 0 ? (
                <p className="mt-3 text-sm text-subtle">Inbox zero. Impressive.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {emails.map((email, i) => (
                    <li key={i} className="truncate text-sm text-muted">
                      <span className="font-mono text-xs text-foreground">
                        {email.from.replace(/<.*>/, "").trim()}
                      </span>{" "}
                      — {email.subject}
                    </li>
                  ))}
                </ul>
              )}
            </GlassPanel>
          </motion.div>

          <motion.div variants={fadeRise} whileHover={{ y: -2 }}>
            <GlassPanel className="min-h-40 p-5 transition-colors hover:border-border-glass-strong">
              <PanelHeader>Tasks</PanelHeader>
              {tasks.length === 0 ? (
                <p className="mt-3 text-sm text-subtle">Nothing open. Ask SAGE to add one.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {tasks.slice(0, 4).map((task, i) => (
                    <li key={task.id} className="flex items-baseline gap-3 text-sm">
                      <span className="hud-label w-8 shrink-0">{String(i + 1).padStart(2, "0")}</span>
                      <span className="truncate text-muted">{task.title}</span>
                      {task.dueAt && (
                        <span className="hud-label ml-auto shrink-0">
                          {new Date(task.dueAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase()}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </GlassPanel>
          </motion.div>

          <motion.div variants={fadeRise} whileHover={{ y: -2 }}>
            <GlassPanel className="min-h-40 p-5 transition-colors hover:border-border-glass-strong">
              <PanelHeader tone="warn">Reminders</PanelHeader>
              {reminders.length === 0 ? (
                <p className="mt-3 text-sm text-subtle">None pending. Say &quot;remind me to…&quot;</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {reminders.slice(0, 4).map((reminder) => (
                    <li key={reminder.id} className="flex items-baseline gap-3 text-sm">
                      <span className="hud-label w-24 shrink-0 tabular-nums">
                        {new Date(reminder.remindAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                        }).toUpperCase()}
                      </span>
                      <span className="truncate text-muted">{reminder.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </GlassPanel>
          </motion.div>
        </motion.div>

        <motion.p variants={fadeRise} className="hud-label mt-6 text-center !text-subtle">
          ⌘K COMMAND · MIC ORB FOR VOICE
        </motion.p>
      </motion.div>
    </div>
  );
}
