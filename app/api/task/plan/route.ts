import { NextResponse } from "next/server";
import { z } from "zod";
import { generateObject } from "ai";
import { getModel } from "@/infrastructure/llm";
import { db, DEFAULT_USER_ID, ensureDefaultUser } from "@/infrastructure/db/supabase";
import { listUpcomingEvents } from "@/infrastructure/integrations/google";
import { TZ, tzHour, HUMAN_RULES, OWNER } from "@/lib/config";

export const maxDuration = 45;

/* ── breakdown: one big task → concrete subtasks ─────────────── */

const breakdownSchema = z.object({
  subtasks: z.array(z.object({
    title: z.string().describe("A single concrete step, phrased as an action. Under 80 characters."),
    minutes: z.number().describe("Rough effort in minutes."),
  })).min(2).max(8),
});

/* ── next: the one thing to do right now ─────────────────────── */

const nextSchema = z.object({
  taskId: z.string().describe("id of the chosen task, copied exactly from the list"),
  reason: z.string().describe("One sentence on why this one, now — reference the actual constraint (time left, due date, energy, what's next in the calendar)."),
  minutes: z.number().describe("How long to give it before stopping."),
});

/* ── schedule: parse natural language into a due time ─────────── */

const scheduleSchema = z.object({
  title: z.string().describe("The task itself, with the timing words stripped out."),
  dueAt: z.string().describe("Absolute ISO 8601 timestamp with timezone offset. Empty string if the text carries no timing."),
  interpretation: z.string().describe("Plain restatement of when this lands, e.g. 'Thursday 7pm'."),
});

function nowInTz(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, dateStyle: "full", timeStyle: "short",
  }).format(new Date());
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: "breakdown" | "next" | "schedule";
    taskId?: string; title?: string; text?: string; commit?: boolean;
  };
  const model = getModel("smart") ?? getModel("fast");
  if (!model) return NextResponse.json({ ok: false, error: "no model" }, { status: 400 });

  /* ── break a task into steps, optionally creating them ── */
  if (body.action === "breakdown") {
    const title = body.title?.trim();
    if (!title) return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });

    const { object } = await generateObject({
      model, schema: breakdownSchema,
      system:
        "Break a task into the smallest set of concrete steps that actually finishes it. Each step must be independently doable and obviously done-or-not — no vague verbs like 'research' or 'think about'. Prefer 3-5 steps; only go further if the task genuinely needs it.",
      prompt: `Task: "${title}"`,
    });

    if (body.commit) {
      await ensureDefaultUser();
      const rows = object.subtasks.map((s, i) => ({
        id: crypto.randomUUID(), userId: DEFAULT_USER_ID,
        title: s.title, priority: 2, source: "breakdown",
        // preserve the model's ordering as creation order
        createdAt: new Date(Date.now() + i).toISOString(),
      }));
      await db.from("Task").insert(rows);
    }
    return NextResponse.json({ ok: true, data: object });
  }

  /* ── pick the single next thing, given the real day ── */
  if (body.action === "next") {
    const [{ data: tasks }, events, { data: health }] = await Promise.all([
      db.from("Task").select("id, title, status, dueAt, priority")
        .eq("userId", DEFAULT_USER_ID).in("status", ["todo", "doing"]).limit(60),
      listUpcomingEvents(4).catch(() => null),
      db.from("Event").select("payload").eq("userId", DEFAULT_USER_ID)
        .eq("type", "health.report")
        .gte("createdAt", new Date(Date.now() - 36 * 3600e3).toISOString())
        .order("createdAt", { ascending: false }).limit(1).maybeSingle(),
    ]);

    if (!tasks?.length) {
      return NextResponse.json({ ok: true, data: { empty: true, reason: "Nothing open, sir. Enjoy it." } });
    }

    const hour = tzHour();
    const band = hour < 11 ? "morning, sharpest" : hour < 15 ? "midday" : hour < 19 ? "afternoon, flagging" : "evening, low";
    const sleep = (health?.payload as { sleepHours?: number } | null)?.sleepHours;
    const nextEv = events?.[0];

    const { object } = await generateObject({
      model, schema: nextSchema,
      system:
        `You are SAGE, picking exactly one task for ${OWNER} to start now. ${HUMAN_RULES} ` +
        "Weigh: anything overdue, what fits before his next commitment, and whether the hour suits deep work or admin. Hard tasks belong in his sharp hours, admin in the flagging ones. Copy the chosen id exactly. Be specific about the constraint driving the choice — never generic encouragement.",
      prompt: [
        `It is ${nowInTz()} — ${band}.`,
        sleep ? `He slept ${sleep.toFixed(1)}h last night.` : "",
        nextEv ? `Next commitment: ${nextEv.summary} at ${new Date(nextEv.start).toISOString()}.` : "Nothing in the calendar soon.",
        ``,
        `Open tasks:`,
        ...tasks.map((t) => `- id=${t.id} | ${t.title}${t.dueAt ? ` | due ${t.dueAt}` : ""} | priority ${t.priority}`),
      ].filter(Boolean).join("\n"),
    });

    const chosen = tasks.find((t) => t.id === object.taskId) ?? tasks[0];
    return NextResponse.json({
      ok: true,
      data: { task: { id: chosen.id, title: chosen.title }, reason: object.reason, minutes: object.minutes },
    });
  }

  /* ── "remind me Thursday after gym" → a real timestamp ── */
  if (body.action === "schedule") {
    const text = body.text?.trim();
    if (!text) return NextResponse.json({ ok: false, error: "text required" }, { status: 400 });

    const { object } = await generateObject({
      model, schema: scheduleSchema,
      system:
        "Convert a natural-language task into a title and an absolute timestamp. Resolve relative wording ('tomorrow', 'Thursday', 'next week', 'this evening') against the supplied current time, and keep the app's timezone offset. If the text implies a time of day rather than a clock time, choose a sensible hour and say so in the interpretation. Return an empty dueAt when there is genuinely no timing — never invent one.",
      prompt: `Current time: ${nowInTz()} (timezone ${TZ}).\n\nText: "${text}"`,
    });

    // Trust the model's parse only if it produced a real, future-ish date.
    const parsed = object.dueAt ? new Date(object.dueAt) : null;
    const valid = parsed && !Number.isNaN(parsed.getTime());

    if (body.commit) {
      await ensureDefaultUser();
      await db.from("Task").insert({
        id: crypto.randomUUID(), userId: DEFAULT_USER_ID,
        title: object.title || text, priority: 2,
        ...(valid ? { dueAt: parsed.toISOString() } : {}),
      });
    }
    return NextResponse.json({
      ok: true,
      data: {
        title: object.title || text,
        dueAt: valid ? parsed.toISOString() : null,
        interpretation: valid ? object.interpretation : "no date detected",
      },
    });
  }

  return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
}
