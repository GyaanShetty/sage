import { tool } from "ai";
import { z } from "zod";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { recallMemories } from "@/core/memory/recall";
import { listApplications, upsertApplication, STAGES } from "@/core/career/scan";
import { analyse } from "@/core/career/pipeline";
import { enqueuePhoneAction, PHONE_ACTIONS } from "@/core/phone/queue";
import { addLink, LINK_KINDS, type LinkKind } from "@/core/links/graph";
import { setTaskMeta } from "@/core/tasks/meta";
import { research } from "@/core/research/deep";

/**
 * Domain tools — the rest of SAGE.
 *
 * The native pack covers tasks, calendar, email and search, so voice could talk
 * about the assistant's own scratchpad but knew nothing about the pipeline,
 * the portfolio, the spending or the automations that were running on the
 * user's behalf. Everything below already had a page and a store; none of it
 * was reachable by asking.
 *
 * These read and write the same generic Event rows the pages use, so the
 * spoken path and the visual one can never drift apart.
 */

const EVENT = {
  holding: "portfolio.holding",
  expense: "finance.expense",
  health: "health.report",
  workout: "health.workout",
} as const;

/** Newest-first Event payloads of one type. */
async function events<T>(type: string, limit = 50): Promise<T[]> {
  const { data } = await db
    .from("Event")
    .select("payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", type)
    .order("createdAt", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => r.payload as T);
}

export const domainTools = {
  // ── Career ──────────────────────────────────────────────────────────────
  career_pipeline: tool({
    description:
      "Look at the user's job/internship pipeline: applications, what stage each is in, conversion rates, which have gone quiet, and upcoming deadlines. Use for any question about applications, interviews, offers or job hunting.",
    inputSchema: z.object({
      stage: z.enum(["applied", "assessment", "interview", "offer", "rejected"]).optional()
        .describe("Filter to one stage; omit for the whole pipeline"),
    }),
    execute: async ({ stage }) => {
      const apps = await listApplications();
      const { funnel, insights } = analyse(apps);
      const byId = new Map(insights.map((i) => [i.id, i]));
      const rows = (stage ? apps.filter((a) => a.stage === stage) : apps).slice(0, 25).map((a) => ({
        company: a.company,
        role: a.role,
        stage: a.stage,
        daysInStage: byId.get(a.id)?.daysInStage ?? null,
        quiet: byId.get(a.id)?.stale ?? false,
        daysToDeadline: byId.get(a.id)?.daysToDeadline ?? null,
      }));
      return {
        ok: true,
        total: funnel.total,
        counts: funnel.counts,
        interviewRatePct: Math.round(funnel.interviewRate * 100),
        offerRatePct: Math.round(funnel.offerRate * 100),
        medianDaysToInterview: funnel.medianDaysToInterview,
        applications: rows,
      };
    },
  }),

  career_update: tool({
    description:
      "Add an application to the pipeline, or move an existing one to a new stage. Use when the user says they applied somewhere, got an OA/interview, or received an offer or rejection.",
    inputSchema: z.object({
      company: z.string().max(80),
      role: z.string().max(120).optional(),
      stage: z.enum(STAGES).describe("Where it stands now"),
      deadline: z.string().datetime().optional(),
    }),
    execute: async ({ company, role, stage, deadline }) => {
      // Match an existing application before creating one, or saying "I got the
      // Google interview" would silently open a second Google card.
      const apps = await listApplications();
      const hit = apps.find(
        (a) =>
          a.company.toLowerCase() === company.toLowerCase() &&
          (!role || a.role.toLowerCase() === role.toLowerCase()),
      ) ?? apps.find((a) => a.company.toLowerCase() === company.toLowerCase());

      const id = await upsertApplication({
        ...(hit ? { id: hit.id } : {}),
        company,
        ...(role ? { role } : {}),
        stage,
        ...(deadline ? { deadline } : {}),
        source: "manual",
      });
      return { ok: true, id, action: hit ? "moved" : "created", company, stage };
    },
  }),

  // ── Money ───────────────────────────────────────────────────────────────
  portfolio_status: tool({
    description:
      "The user's investment holdings and what they are worth. Use for questions about their portfolio, stocks, crypto or net worth.",
    inputSchema: z.object({}),
    execute: async () => {
      const holdings = await events<{ symbol?: string; qty?: number; avgPrice?: number; kind?: string }>(EVENT.holding, 100);
      if (holdings.length === 0) return { ok: true, holdings: [], note: "No holdings recorded yet." };
      // Only the recorded book value — quotes live in the markets layer, and
      // inventing a current price here would be worse than saying nothing.
      const rows = holdings.slice(0, 40).map((h) => ({
        symbol: h.symbol ?? "?", qty: h.qty ?? 0, avgPrice: h.avgPrice ?? null, kind: h.kind ?? "equity",
      }));
      const bookValue = rows.reduce((s, r) => s + (r.qty ?? 0) * (r.avgPrice ?? 0), 0);
      return { ok: true, count: rows.length, bookValue: Math.round(bookValue), holdings: rows };
    },
  }),

  spending_summary: tool({
    description:
      "Recent expenses and subscriptions, totalled. Use for questions about spending, budget, or where the money went.",
    inputSchema: z.object({
      days: z.number().int().min(1).max(365).default(30),
    }),
    execute: async ({ days }) => {
      const since = Date.now() - days * 86_400_000;
      const all = await events<{ amount?: number; category?: string; label?: string; at?: string }>(EVENT.expense, 300);
      const recent = all.filter((e) => !e.at || new Date(e.at).getTime() >= since);
      const total = recent.reduce((s, e) => s + (e.amount ?? 0), 0);
      const byCategory: Record<string, number> = {};
      for (const e of recent) byCategory[e.category ?? "other"] = (byCategory[e.category ?? "other"] ?? 0) + (e.amount ?? 0);
      return {
        ok: true,
        days,
        count: recent.length,
        total: Math.round(total),
        byCategory,
        largest: recent.slice().sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)).slice(0, 5)
          .map((e) => ({ label: e.label ?? e.category ?? "expense", amount: e.amount ?? 0 })),
      };
    },
  }),

  // ── Body ────────────────────────────────────────────────────────────────
  health_status: tool({
    description:
      "The user's latest health figures — steps, sleep, activity — and recent workouts. Use for questions about fitness, sleep, training or how they are doing physically.",
    inputSchema: z.object({}),
    execute: async () => {
      const [reports, workouts] = await Promise.all([
        events<{ steps?: number; sleepHours?: number; activeMinutes?: number; at?: string }>(EVENT.health, 7),
        events<{ kind?: string; minutes?: number; at?: string }>(EVENT.workout, 7),
      ]);
      const latest = reports[0] ?? null;
      return {
        ok: true,
        latest: latest ? { steps: latest.steps ?? null, sleepHours: latest.sleepHours ?? null, activeMinutes: latest.activeMinutes ?? null } : null,
        recentDays: reports.length,
        avgSteps: reports.length
          ? Math.round(reports.reduce((s, r) => s + (r.steps ?? 0), 0) / reports.length)
          : null,
        workouts: workouts.slice(0, 5).map((w) => ({ kind: w.kind ?? "session", minutes: w.minutes ?? null })),
      };
    },
  }),

  // ── Automations ─────────────────────────────────────────────────────────
  list_automations: tool({
    description:
      "The user's standing automations: what they do, when they fire, whether they are armed, and how the last run went. Use when asked what SAGE is doing on their behalf, or whether something is running.",
    inputSchema: z.object({}),
    execute: async () => {
      const { data } = await db
        .from("Automation")
        .select("id, name, trigger, workflow, enabled, lastRunAt")
        .eq("userId", DEFAULT_USER_ID)
        .limit(30);
      const rows = (data ?? []) as { id: string; name: string; trigger: { type?: string; time?: string; when?: string }; workflow: { directive?: string }; enabled: boolean; lastRunAt: string | null }[];
      return {
        ok: true,
        count: rows.length,
        armed: rows.filter((r) => r.enabled).length,
        automations: rows.map((r) => ({
          name: r.name,
          when: r.trigger?.type === "condition" ? r.trigger.when : `daily ${r.trigger?.time ?? "?"} UTC`,
          armed: r.enabled,
          directive: (r.workflow?.directive ?? "").slice(0, 160),
          lastRunAt: r.lastRunAt,
        })),
      };
    },
  }),

  // ── The phone ───────────────────────────────────────────────────────────
  phone_action: tool({
    description:
      "Ask the user's phone to do something natively: set a reminder, set an alarm, add a calendar event, send a notification, set a Focus mode, or play something. Use whenever they ask to be reminded, woken, or alerted AT A TIME — a task in SAGE does not ring. The phone collects these when it next checks in.",
    inputSchema: z.object({
      kind: z.enum(PHONE_ACTIONS),
      text: z.string().max(200).describe("What to say — the reminder or alarm title"),
      at: z.string().datetime().optional().describe("ISO time it refers to; required for alarm and reminder"),
      detail: z.string().max(120).optional().describe("Optional extra: list name, focus mode, playlist"),
    }),
    execute: async ({ kind, text, at, detail }) => {
      // An alarm with no time is not an alarm. Better to say so than to queue
      // something the phone will silently drop.
      if ((kind === "alarm" || kind === "reminder") && !at) {
        return { ok: false, error: "That needs a specific time." };
      }
      const queued = await enqueuePhoneAction({ kind, text, at, detail });
      return { ok: true, queued: queued.kind, at: queued.at ?? null, note: "Queued — the phone will pick it up on its next check." };
    },
  }),

  // ── Tasks, in detail ────────────────────────────────────────────────────
  task_details: tool({
    description:
      "Attach detail to an existing task: how long it should take, tags, or longer notes. Use after creating a task when the user gave more than a title.",
    inputSchema: z.object({
      taskId: z.string(),
      estimateMin: z.number().int().min(0).max(10_000).optional(),
      tags: z.array(z.string().max(40)).max(12).optional(),
      notes: z.string().max(4000).optional(),
    }),
    execute: async ({ taskId, ...patch }) => {
      const meta = await setTaskMeta(taskId, patch);
      return { ok: true, taskId, estimateMin: meta.estimateMin ?? null, tags: meta.tags ?? [] };
    },
  }),

  research_topic: tool({
    description:
      "Go and find out about something using live web sources, then tie it back to the user's holdings and work. Use when the answer depends on current facts — a company, a market move, a technology this month — rather than something you already know. Slow (10-20s), so only when the question warrants it.",
    inputSchema: z.object({ topic: z.string().max(300).describe("The question, not just a keyword") }),
    execute: async ({ topic }) => {
      const brief = await research(topic);
      if ("error" in brief) return { ok: false, error: brief.error };
      return {
        ok: true,
        headline: brief.headline,
        summary: brief.summary,
        keyPoints: brief.keyPoints.slice(0, 5),
        soWhat: brief.soWhat.slice(0, 3),
        uncertainty: brief.uncertainty,
        sources: brief.sources.slice(0, 3).map((s) => s.title),
      };
    },
  }),

  link_items: tool({
    description:
      "Connect two things in SAGE so each shows up on the other: a task to an application, a note to a memory, a URL or file to anything. Use when the user says one thing is 'for' or 'about' another.",
    inputSchema: z.object({
      fromKind: z.enum(LINK_KINDS), fromId: z.string(), fromLabel: z.string().max(160),
      toKind: z.enum(LINK_KINDS), toId: z.string(), toLabel: z.string().max(160),
    }),
    execute: async (a) => {
      const link = await addLink(
        { kind: a.fromKind as LinkKind, id: a.fromId, label: a.fromLabel },
        { kind: a.toKind as LinkKind, id: a.toId, label: a.toLabel },
      );
      return link ? { ok: true, linked: `${a.fromLabel} ↔ ${a.toLabel}` } : { ok: false, error: "Could not link those." };
    },
  }),

  // ── Files ───────────────────────────────────────────────────────────────
  list_files: tool({
    description:
      "Files the user has uploaded, newest first, with whether their text could be read. Use before read_file, and whenever they refer to 'the document' or 'that PDF' without naming it.",
    inputSchema: z.object({}),
    execute: async () => {
      const files = await events<{ id?: string; name?: string; uploadedAt?: string; text?: string; chars?: number }>("file.uploaded", 30);
      return {
        ok: true,
        count: files.length,
        files: files.map((f) => ({
          id: f.id ?? "", name: f.name ?? "file",
          uploadedAt: f.uploadedAt ?? null,
          readable: !!f.text, chars: f.chars ?? 0,
        })),
      };
    },
  }),

  read_file: tool({
    description:
      "Read the text of an uploaded file so you can answer questions about it, summarise it, or pull details out of it. Identify the file by id, or by a fragment of its name.",
    inputSchema: z.object({
      idOrName: z.string().max(200),
      /** Long documents are paged rather than truncated silently. */
      page: z.number().int().min(1).max(50).default(1),
    }),
    execute: async ({ idOrName, page }) => {
      const files = await events<{ id?: string; name?: string; text?: string; chars?: number }>("file.uploaded", 40);
      const needle = idOrName.toLowerCase();
      const hit =
        files.find((f) => f.id === idOrName) ??
        files.find((f) => (f.name ?? "").toLowerCase().includes(needle));
      if (!hit) return { ok: false, error: `No uploaded file matching "${idOrName}".` };
      if (!hit.text) return { ok: false, error: `"${hit.name}" has no readable text — it may be a scan or an unsupported format.` };

      // ~6k characters a page keeps a single call well inside the context
      // budget while letting the model ask for more if it needs it.
      const SIZE = 6000;
      const start = (page - 1) * SIZE;
      const slice = hit.text.slice(start, start + SIZE);
      const pages = Math.max(1, Math.ceil(hit.text.length / SIZE));
      if (!slice) return { ok: false, error: `Page ${page} is past the end (${pages} pages).` };
      return { ok: true, name: hit.name, page, pages, text: slice };
    },
  }),

  // ── Memory ──────────────────────────────────────────────────────────────
  recall_memory: tool({
    description:
      "Search everything SAGE knows about the user, semantically. Use before answering any personal question — preferences, history, goals, people, routines — rather than guessing.",
    inputSchema: z.object({
      query: z.string().max(300),
    }),
    execute: async ({ query }) => {
      const found = await recallMemories(query, 8).catch(() => []);
      return {
        ok: true,
        count: found.length,
        memories: found.map((m) => ({ type: m.type, content: m.content })),
      };
    },
  }),
};
