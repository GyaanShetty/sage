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

const STATIC_CARDS = [
  { title: "GitHub", body: "Connect GitHub to see notifications." },
  { title: "News", body: "Your AI-curated brief will appear here." },
];

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Good night";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
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
    <div className="mx-auto max-w-5xl px-8 py-10">
      <motion.div variants={staggerContainer} initial="hidden" animate="visible">
        <motion.h1 variants={fadeRise} className="text-2xl font-semibold tracking-tight">
          {greeting()}.
        </motion.h1>
        <motion.p variants={fadeRise} className="mt-1 text-sm text-muted">
          Press <kbd className="rounded border border-border-glass bg-glass px-1.5 py-0.5 font-mono text-xs">⌘K</kbd> to do anything.
        </motion.p>

        <motion.div variants={fadeRise}>
          <BriefHeader />
        </motion.div>

        <motion.div
          variants={staggerContainer}
          className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <motion.div variants={fadeRise} whileHover={{ y: -2, scale: 1.005 }}>
            <GlassPanel className="h-36 overflow-hidden p-5 transition-colors hover:border-border-glass-strong">
              <h2 className="text-sm font-medium">Tasks</h2>
              {tasks.length === 0 ? (
                <p className="mt-2 text-sm text-subtle">
                  Nothing open. Ask SAGE to add a task.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {tasks.slice(0, 3).map((task) => (
                    <li key={task.id} className="flex items-center gap-2 text-sm text-muted">
                      <span className="size-1.5 shrink-0 rounded-full bg-accent/70" />
                      <span className="truncate">{task.title}</span>
                    </li>
                  ))}
                  {tasks.length > 3 && (
                    <li className="text-xs text-subtle">+{tasks.length - 3} more</li>
                  )}
                </ul>
              )}
            </GlassPanel>
          </motion.div>
          <motion.div variants={fadeRise} whileHover={{ y: -2, scale: 1.005 }}>
            <GlassPanel className="h-36 overflow-hidden p-5 transition-colors hover:border-border-glass-strong">
              <h2 className="text-sm font-medium">Reminders</h2>
              {reminders.length === 0 ? (
                <p className="mt-2 text-sm text-subtle">
                  None set. Try &quot;remind me to…&quot; in chat.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {reminders.slice(0, 3).map((reminder) => (
                    <li key={reminder.id} className="flex items-center gap-2 text-sm text-muted">
                      <span className="size-1.5 shrink-0 rounded-full bg-amber-400/80" />
                      <span className="truncate">{reminder.text}</span>
                      <span className="ml-auto shrink-0 text-xs text-subtle">
                        {new Date(reminder.remindAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </GlassPanel>
          </motion.div>
          <motion.div variants={fadeRise} whileHover={{ y: -2, scale: 1.005 }}>
            <GlassPanel className="h-36 overflow-hidden p-5 transition-colors hover:border-border-glass-strong">
              <h2 className="text-sm font-medium">Calendar</h2>
              {events === null ? (
                <p className="mt-2 text-sm text-subtle">
                  <a href="/settings" className="underline underline-offset-2 hover:text-foreground">
                    Connect Google
                  </a>{" "}
                  to see your day.
                </p>
              ) : events.length === 0 ? (
                <p className="mt-2 text-sm text-subtle">No upcoming events. Enjoy the calm.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {events.map((event, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-muted">
                      <span className="size-1.5 shrink-0 rounded-full bg-emerald-400/80" />
                      <span className="truncate">{event.summary}</span>
                      <span className="ml-auto shrink-0 text-xs text-subtle">
                        {new Date(event.start).toLocaleString(undefined, {
                          weekday: "short",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </GlassPanel>
          </motion.div>
          <motion.div variants={fadeRise} whileHover={{ y: -2, scale: 1.005 }}>
            <GlassPanel className="h-36 overflow-hidden p-5 transition-colors hover:border-border-glass-strong">
              <h2 className="text-sm font-medium">Email</h2>
              {emails === null ? (
                <p className="mt-2 text-sm text-subtle">
                  <a href="/settings" className="underline underline-offset-2 hover:text-foreground">
                    Connect Google
                  </a>{" "}
                  to see unread mail.
                </p>
              ) : emails.length === 0 ? (
                <p className="mt-2 text-sm text-subtle">Inbox zero. Impressive.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {emails.map((email, i) => (
                    <li key={i} className="truncate text-sm text-muted">
                      <span className="text-foreground">
                        {email.from.replace(/<.*>/, "").trim()}
                      </span>{" "}
                      — {email.subject}
                    </li>
                  ))}
                </ul>
              )}
            </GlassPanel>
          </motion.div>
          {STATIC_CARDS.map((card) => (
            <motion.div key={card.title} variants={fadeRise} whileHover={{ y: -2, scale: 1.005 }}>
              <GlassPanel className="h-36 p-5 transition-colors hover:border-border-glass-strong">
                <h2 className="text-sm font-medium">{card.title}</h2>
                <p className="mt-2 text-sm text-subtle">{card.body}</p>
              </GlassPanel>
            </motion.div>
          ))}
        </motion.div>
      </motion.div>
    </div>
  );
}
