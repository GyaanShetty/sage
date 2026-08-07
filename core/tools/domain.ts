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
import { tzDay } from "@/lib/config";

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

  // ── Mail ────────────────────────────────────────────────────────────────
  triage_inbox: tool({
    description:
      "Read the unread inbox and say what actually needs him. Use for 'anything important in my email', 'what's in my inbox', 'do I need to reply to anything'. Slower than a count — it reads each message.",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(8).default(5).describe("How many to read properly"),
    }),
    execute: async ({ limit }) => {
      const { listGmail, getGmailMessage } = await import("@/infrastructure/integrations/google");

      const rows = await listGmail("is:unread in:inbox", Math.min(12, limit * 2));
      if (rows === null) return { ok: false, error: "Gmail isn't connected (Settings → Connect Google)." };
      if (rows.length === 0) return { ok: true, unread: 0, note: "Inbox is clear." };

      // Read the important ones first, and only as many as asked — each is a
      // round trip, and reading twelve to answer "anything urgent?" is a
      // minute of waiting for a one-sentence answer.
      const ordered = [...rows].sort((a, b) => Number(b.important) - Number(a.important));
      const bodies = await Promise.all(
        ordered.slice(0, limit).map(async (r) => {
          const full = r.id ? await getGmailMessage(r.id).catch(() => null) : null;
          return {
            from: r.from,
            subject: r.subject,
            important: r.important ?? false,
            // The body if it could be read, the snippet if not — never silence.
            text: (full?.body || r.snippet || "").slice(0, 1200),
          };
        }),
      );

      return {
        ok: true,
        unread: rows.length,
        read: bodies.length,
        messages: bodies,
        note: "Summarise these for him: who needs what, and by when. Say plainly if none of it matters.",
      };
    },
  }),

  draft_reply: tool({
    description:
      "Write a reply and save it as a Gmail DRAFT. Nothing sends — he reviews and sends it himself. Use when he says 'reply to X saying …' or 'draft a response to that'.",
    inputSchema: z.object({
      to: z.string().max(200).describe("Email address, or the sender's name if that is all you have"),
      subject: z.string().max(200),
      body: z.string().max(4000),
    }),
    execute: async ({ to, subject, body }) => {
      const { createGmailDraft } = await import("@/infrastructure/integrations/google");
      const ok = await createGmailDraft(to, subject, body);
      if (ok === null) return { ok: false, error: "Gmail isn't connected." };
      return ok
        ? { ok: true, drafted: `to ${to}`, note: "Saved as a draft in Gmail — it will not send until he does." }
        : { ok: false, error: "Couldn't create that draft." };
    },
  }),

  // ── Studying ────────────────────────────────────────────────────────────
  log_study: tool({
    description:
      "Record study against a skill, said out loud — 'I did 40 minutes of DSA on trees', 'note for DBMS: normal forms finally clicked', 'I still don't get how B-trees split'. Matches the skill by name; creates it if it does not exist.",
    inputSchema: z.object({
      skill: z.string().max(60).describe("The skill's name — DSA, DBMS, Systems Design…"),
      kind: z.enum(["session", "note", "resource", "question", "insight"])
        .describe("question = something he did NOT understand; insight = something that clicked"),
      text: z.string().max(2000),
      minutes: z.number().int().min(1).max(600).optional().describe("Only for a session"),
      url: z.string().max(500).optional(),
      tags: z.array(z.string().max(30)).max(6).optional(),
    }),
    execute: async ({ skill, kind, text, minutes, url, tags }) => {
      const { listSkills, upsertSkill } = await import("@/core/education/skills");
      const { addEntry } = await import("@/core/education/log");

      // Match before creating, or "DSA" said twice becomes two skills and the
      // history splits across both.
      const all = await listSkills();
      const hit = all.find((s) => s.name.toLowerCase() === skill.toLowerCase())
        ?? all.find((s) => s.name.toLowerCase().includes(skill.toLowerCase()));

      const target = hit ?? await upsertSkill({ name: skill, category: "General" });
      if (!target) return { ok: false, error: "Couldn't find or create that skill." };

      const entry = await addEntry({
        skillId: target.id, kind, text,
        ...(minutes ? { minutes } : {}),
        ...(url ? { url } : {}),
        ...(tags ? { tags } : {}),
      });
      if (!entry) return { ok: false, error: "Couldn't save that." };

      // Practising updates the skill's own timestamp too, so the education
      // page does not still say "12 days ago" after a session logged by voice.
      if (kind === "session") await upsertSkill({ id: target.id, lastPractisedAt: new Date().toISOString() });

      return { ok: true, skill: target.name, kind, created: !hit, logged: text.slice(0, 80) };
    },
  }),

  study_status: tool({
    description:
      "How studying is going: hours per skill, what has been neglected, and — most usefully — the questions he wrote down and never answered. Use for 'how's my prep', 'what am I behind on', 'what don't I understand yet'.",
    inputSchema: z.object({ skill: z.string().max(60).optional() }),
    execute: async ({ skill }) => {
      const { listSkills, summarise } = await import("@/core/education/skills");
      const { listEntries, studyStats } = await import("@/core/education/log");

      const all = await listSkills();
      const one = skill
        ? all.find((s) => s.name.toLowerCase().includes(skill.toLowerCase()))
        : undefined;

      const entries = await listEntries(one?.id);
      const stats = studyStats(entries);

      return {
        ok: true,
        scope: one?.name ?? "everything",
        hours: Math.round((stats.minutes / 60) * 10) / 10,
        sessions: stats.sessions,
        lastStudiedAt: stats.lastStudiedAt,
        // The honest measure of what he does not know.
        openQuestions: stats.openQuestions.slice(0, 6).map((q) => q.text),
        skills: (one ? [one] : all).slice(0, 12).map((s) => ({
          name: s.name, level: s.level, target: s.target,
          daysSince: s.lastPractisedAt
            ? Math.floor((Date.now() - new Date(s.lastPractisedAt).getTime()) / 86_400_000)
            : null,
        })),
        ...(one ? {} : { overview: summarise(all) }),
      };
    },
  }),

  log_expense: tool({
    description:
      "Record something the user spent money on, said out loud — 'I spent 400 on lunch', 'paid the electricity bill, 2100'. Amounts are in rupees.",
    inputSchema: z.object({
      amount: z.number().positive().max(10_000_000),
      merchant: z.string().max(80).describe("Where it went — the shop, the service, the person"),
      // Free text, matched to his budget below. A fixed enum here forced every
      // spoken expense into one of eight slugs, so "put 200 on mess" was filed
      // under something he had never chosen.
      category: z.string().max(40).describe("The budget category it belongs to, e.g. food, rent, mess, books"),
      recurring: z.boolean().optional().describe("True only for subscriptions and standing bills"),
    }),
    execute: async (e) => {
      const { addExpense, knownCategories, normaliseCategory } = await import("@/core/finance/expenses");
      const { getPlan, budgetStatus, currentMonth } = await import("@/core/finance/budget");
      const { listExpenses } = await import("@/core/finance/expenses");

      // Snap to one of his own envelopes when it matches, so a spoken "mess"
      // lands on the "Mess Fees" line rather than creating a second one.
      const spoken = normaliseCategory(e.category);
      const known = await knownCategories().catch(() => [] as string[]);
      const match = known.find((c) => normaliseCategory(c) === spoken)
        ?? known.find((c) => normaliseCategory(c).startsWith(spoken) || spoken.startsWith(normaliseCategory(c)));
      const category = match ? normaliseCategory(match) : spoken;

      const id = await addExpense({ ...e, category, source: "manual" });

      // Say what it did to the budget, not just that it saved. "Logged" is
      // bookkeeping; "that puts food 300 over for the month" is the reason
      // he asked SAGE instead of a spreadsheet.
      const plan = await getPlan(currentMonth()).catch(() => null);
      if (!plan) return { ok: true, id, logged: `₹${e.amount} at ${e.merchant}` };

      const status = budgetStatus(plan, await listExpenses(60));
      const line = status.lines.find((l) => normaliseCategory(l.category) === category);
      return {
        ok: true,
        id,
        logged: `₹${e.amount} at ${e.merchant}`,
        budget: line
          ? { category: line.category, spent: line.spent, limit: line.limit, remaining: line.remaining, state: line.state }
          : { note: `${category} has no budget line this month` },
      };
    },
  }),

  budget_status: tool({
    description:
      "How the month's budget is going: what is spent, what is left, what is on pace to overshoot. Use for 'how am I doing on budget', 'can I afford X', 'how much is left for food'.",
    inputSchema: z.object({}),
    execute: async () => {
      const { getPlan, budgetStatus, currentMonth } = await import("@/core/finance/budget");
      const { listExpenses } = await import("@/core/finance/expenses");

      const plan = await getPlan(currentMonth());
      if (!plan) return { ok: true, note: "No budget set for this month yet — there is one on the portfolio page." };

      const s = budgetStatus(plan, await listExpenses(60));
      return {
        ok: true,
        month: s.month,
        dayOfMonth: `${s.elapsed} of ${s.days}`,
        spent: s.totalSpent,
        planned: s.totalBudget,
        onPaceFor: s.projectedTotal,
        leftToSpend: s.leftToSpend,
        lines: s.lines.map((l) => ({ category: l.category, spent: l.spent, limit: l.limit, state: l.state })),
        unbudgeted: s.unbudgetedTotal,
        notes: s.notes,
      };
    },
  }),

  log_workout: tool({
    description:
      "Record a training session the user describes out loud — 'I did chest and triceps for 50 minutes', 'went for a 5k'. Use for sessions NOT already in Hevy; Hevy syncs itself and logging twice would double the count.",
    inputSchema: z.object({
      type: z.string().max(40).describe("push, pull, legs, run, swim, yoga…"),
      minutes: z.number().int().min(1).max(600),
      intensity: z.enum(["easy", "moderate", "hard"]).optional(),
      note: z.string().max(300).optional(),
    }),
    execute: async (w) => {
      const { addWorkout } = await import("@/core/health/store");
      const id = await addWorkout(w);
      return { ok: true, id, logged: `${w.type}, ${w.minutes} min` };
    },
  }),

  training_progress: tool({
    description:
      "How the user's lifts are trending: what is going up, what is going backwards, and which lifts have been neglected. Use for 'am I getting stronger', 'how's my training', 'what am I neglecting'.",
    inputSchema: z.object({ days: z.number().int().min(28).max(365).optional() }),
    execute: async ({ days }) => {
      const { trainingProgress } = await import("@/core/health/progression");
      const p = await trainingProgress(days ?? 120);
      return {
        ok: true,
        topLifts: p.lifts.slice(0, 6).map((l) => ({
          name: l.name, best: l.bestKg, latest: l.latestKg, changeKg: l.changeKg, trend: l.trend, daysSince: l.daysSince,
        })),
        nextSession: p.suggestion
          ? { focus: p.suggestion.focus, why: p.suggestion.reason, targets: p.suggestion.targets.map((t) => `${t.lift} ${t.suggestKg ?? "bw"}kg — ${t.note}`) }
          : null,
        recentBests: p.records.filter((r) => r.daysAgo <= 30).slice(0, 4).map((r) => `${r.lift} ${r.kg}kg (was ${r.previousKg})`),
        neglected: p.neglected.map((l) => l.name),
        lastWeekVolumeKg: p.weeklyVolume.at(-1)?.volumeKg ?? 0,
        notes: p.notes,
      };
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

  // ── Judgement ───────────────────────────────────────────────────────────
  argue_against: tool({
    description:
      "Put the case AGAINST something he is about to do, grounded in his own track record. Use whenever he says he is going to commit to a view — a trade, an offer, a bet — and before recording a decision. Also use if he asks 'talk me out of this' or 'what am I missing'. It is allowed to conclude the reasoning is sound.",
    inputSchema: z.object({
      title: z.string().max(200).describe("The call, in his words"),
      reasoning: z.string().max(2000),
      expectation: z.string().max(500).describe("What he expects to be true, and by when"),
      confidence: z.number().min(50).max(99),
      domain: z.enum(["markets", "career", "study", "health", "money", "life"]),
    }),
    execute: async (input) => {
      const { argueAgainst } = await import("@/core/decisions/advocate");
      const r = await argueAgainst(input);
      if ("error" in r) return { ok: false, error: r.error };
      return {
        ok: true,
        verdict: r.verdict,
        theCaseAgainst: r.strongestCase,
        blindSpot: r.blindSpot,
        wouldFalsify: r.wouldFalsify,
        // Named rather than signed, so it cannot be read out backwards.
        confidence: r.suggestedConfidence === r.claimed
          ? `leave it at ${r.claimed}%`
          : `${r.suggestedConfidence < r.claimed ? "lower" : "raise"} it to ${r.suggestedConfidence}% — ${r.why}`,
      };
    },
  }),

  play_it_out: tool({
    description:
      "Work through a decision against his actual money, calendar, goals and judgement record — 'what if I take the offer', 'should I move', 'is it worth doing X'. Use for any open-ended life or career question where the answer depends on his situation rather than on general advice.",
    inputSchema: z.object({ question: z.string().max(400) }),
    execute: async ({ question }) => {
      const { simulate } = await import("@/core/simulate");
      const r = await simulate(question);
      if ("error" in r) return { ok: false, error: r.error };
      return {
        ok: true,
        reading: r.reading,
        ifYouDo: r.ifYouDo.map((x) => `${x.horizon}: ${x.effect}`),
        ifYouDont: r.ifYouDont,
        hinges: r.hinges,
        unknowns: r.unknowns,
        lean: r.lean,
      };
    },
  }),

  dossier: tool({
    description:
      "Everything SAGE already knows about a person, company or topic — past emails, memories, notes, applications, meetings, decisions. Use before a meeting or interview, or when he asks 'what do I know about X', 'have I dealt with them before', 'remind me about Y'.",
    inputSchema: z.object({ subject: z.string().max(120) }),
    execute: async ({ subject }) => {
      const { buildDossier } = await import("@/core/dossier");
      const d = await buildDossier(subject);
      if (d.empty) return { ok: true, subject: d.subject, note: "Nothing on file about that." };
      return {
        ok: true,
        subject: d.subject,
        lastSeen: d.lastSeen,
        entries: d.entries.slice(0, 12).map((e) => `[${e.source}] ${e.title}${e.detail ? ` — ${e.detail}` : ""}`),
      };
    },
  }),

  whats_off: tool({
    description:
      "What has departed from his own normal patterns — spending, sleep, steps, study, market moves — measured against his history rather than fixed thresholds. Use for 'anything unusual', 'is something off', or as part of a check-in.",
    inputSchema: z.object({}),
    execute: async () => {
      const { detectAnomalies } = await import("@/core/anomaly");
      const found = await detectAnomalies();
      if (found.length === 0) return { ok: true, note: "Nothing out of the ordinary — everything is within his usual range." };
      return {
        ok: true,
        count: found.length,
        anomalies: found.map((a) => `${a.detail} (${Math.abs(a.z).toFixed(1)} standard deviations, from ${a.n} days of history)`),
      };
    },
  }),

  // ── Patterns ────────────────────────────────────────────────────────────
  readiness_check: tool({
    description:
      "Training readiness from load and sleep — the acute:chronic workload ratio against his own four-week baseline. Use for 'should I train today', 'am I overdoing it', 'how's my recovery', or before suggesting a hard session.",
    inputSchema: z.object({}),
    execute: async () => {
      const { readiness } = await import("@/core/health/readiness");
      const r = await readiness();
      return {
        ok: true,
        band: r.band,
        ratio: r.ratio,
        score: r.score,
        sleepDebtHours: r.sleepDebt,
        verdict: r.verdict,
        advice: r.advice,
      };
    },
  }),

  attention_drift: tool({
    description:
      "How his interests have moved month to month — what is newly on his mind, what has gone quiet, what is constant. Use for 'what have I been thinking about', 'have I drifted', or in a reflective review.",
    inputSchema: z.object({}),
    execute: async () => {
      const { drift } = await import("@/core/memory/drift");
      const d = await drift();
      return {
        ok: true,
        months: d.months.length,
        emerged: d.emerged,
        faded: d.faded,
        constant: d.constant,
        notes: d.notes,
      };
    },
  }),

  shadow_book: tool({
    description:
      "Trades he considered and did not take, scored against what actually happened — whether his hesitation is costing him or saving him. Also use to LOG one when he says he thought about a trade and passed.",
    inputSchema: z.object({
      log: z.boolean().optional().describe("True to record a skipped trade rather than read the book"),
      symbol: z.string().max(20).optional(),
      side: z.enum(["buy", "short"]).optional(),
      price: z.number().optional().describe("What he would have paid"),
      size: z.number().optional(),
      thesis: z.string().max(500).optional(),
      whyNot: z.string().max(300).optional().describe("Why he did not take it — the half that teaches something"),
    }),
    execute: async (input) => {
      const { scoreShadow, addShadow } = await import("@/core/portfolio/shadow");

      if (input.log) {
        if (!input.symbol || !input.price || !input.size) {
          return { ok: false, error: "A skipped trade needs a symbol, the price he would have paid, and a size." };
        }
        await addShadow({
          symbol: input.symbol, side: input.side ?? "buy",
          price: input.price, size: input.size,
          thesis: input.thesis ?? "", whyNot: input.whyNot ?? "",
        });
        return { ok: true, logged: `${input.side ?? "buy"} ${input.symbol} at ${input.price}` };
      }

      const s = await scoreShadow();
      return {
        ok: true,
        scored: s.scored,
        wouldHaveWon: s.wouldHaveWon,
        netPnl: Math.round(s.netPnl),
        verdict: s.verdict,
      };
    },
  }),

  // ── Status ──────────────────────────────────────────────────────────────
  sitrep: tool({
    description:
      "Where everything stands right now: next commitment, tasks, steps, budget pace, markets, inbox, and whether SAGE itself is healthy. Use for 'what's the situation', 'sitrep', 'how are we doing', 'anything I should know' — and before answering any broad 'what should I do now' question.",
    inputSchema: z.object({}),
    execute: async () => {
      const { buildSitrep } = await import("@/core/sitrep");
      const s = await buildSitrep();
      return {
        ok: true,
        at: s.at,
        next: s.nextEventTitle
          ? { title: s.nextEventTitle, at: s.nextEventAt, inMinutes: s.nextEventAt ? Math.round((new Date(s.nextEventAt).getTime() - Date.now()) / 60_000) : null }
          : null,
        // Alerts first: if something is wrong that is the answer, and the rest
        // is context.
        alerts: s.alerts.map((a) => `${a.label}: ${a.value}${a.detail ? ` (${a.detail})` : ""}`),
        lines: s.lines.map((l) => `${l.label}: ${l.value}${l.detail ? ` (${l.detail})` : ""}`),
      };
    },
  }),

  overnight_report: tool({
    description:
      "What SAGE did overnight — questions researched, tomorrow prepared, things that slipped. Use for 'what did you do last night', 'anything while I was asleep', or as part of a morning greeting.",
    inputSchema: z.object({}),
    execute: async () => {
      const { latestNightReport } = await import("@/core/night/shift");
      const report = await latestNightReport();
      if (!report) return { ok: true, note: "No night shift has run yet." };
      return {
        ok: true,
        ranAt: report.ranAt,
        quiet: report.quiet,
        greeting: report.greeting,
        items: report.items.map((i) => `[${i.kind}] ${i.title}${i.body ? ` — ${i.body.slice(0, 200)}` : ""}`),
      };
    },
  }),

  // ── Decisions ───────────────────────────────────────────────────────────
  record_decision: tool({
    description:
      "Record a decision in the journal: the call, why, what he expects, and how sure he is. Use whenever he commits to a view or a choice — a trade, an offer, a bet on how something plays out — especially if he says how confident he is. Do not use for tasks or reminders; this is for judgements that can later be scored right or wrong.",
    inputSchema: z.object({
      title: z.string().max(200).describe("The call itself, in his words"),
      reasoning: z.string().max(2000).describe("Why he thinks so, as he said it"),
      expectation: z.string().max(500).describe("What should be true by the review date — specific enough to be wrong"),
      confidence: z.number().min(50).max(99).describe("How sure, 50-99. Ask if he did not say; do not invent one."),
      domain: z.enum(["markets", "career", "study", "health", "money", "life"]),
      reviewInDays: z.number().min(1).max(1095).describe("When to come back and score it. Default 90."),
    }),
    execute: async ({ reviewInDays, ...input }) => {
      const { addDecision } = await import("@/core/decisions/store");
      const reviewAt = new Date(Date.now() + reviewInDays * 86_400_000);
      reviewAt.setHours(9, 0, 0, 0);

      const id = await addDecision({ ...input, reviewAt: reviewAt.toISOString() });

      // The reminder is the half that makes the journal work — an unreviewed
      // decision measures nothing.
      const { db, DEFAULT_USER_ID } = await import("@/infrastructure/db/supabase");
      await db.from("Reminder").insert({
        id: crypto.randomUUID(), userId: DEFAULT_USER_ID,
        text: `Review your call: ${input.title.slice(0, 120)}`,
        remindAt: reviewAt.toISOString(),
      }).then(() => undefined, () => undefined);

      return {
        ok: true, id,
        recorded: input.title,
        confidence: input.confidence,
        reviewOn: tzDay(reviewAt),
      };
    },
  }),

  calibration_check: tool({
    description:
      "How well his confidence has matched reality: hit rate, average confidence, whether he is over- or under-confident, and which decisions are owed a verdict. Use for 'how are my calls doing', 'am I overconfident', 'what do I owe a review'.",
    inputSchema: z.object({}),
    execute: async () => {
      const { listDecisions, dueForReview } = await import("@/core/decisions/store");
      const { calibrate } = await import("@/core/decisions/calibration");
      const all = await listDecisions();
      const cal = calibrate(all);
      const due = dueForReview(all);
      return {
        ok: true,
        scored: cal.scored,
        hitRate: Math.round(cal.hitRate * 100),
        averageConfidence: Math.round(cal.meanConfidence * 100),
        // Named rather than signed, so it cannot be read backwards aloud.
        bias: cal.overconfidence < -0.05 ? "overconfident" : cal.overconfidence > 0.05 ? "underconfident" : "well calibrated",
        notes: cal.notes,
        awaitingVerdict: due.slice(0, 5).map((d) => ({ title: d.title, confidence: d.confidence, expected: d.expectation })),
      };
    },
  }),

  // ── Papers ──────────────────────────────────────────────────────────────
  find_papers: tool({
    description:
      "Search arXiv for actual research papers on a topic — machine learning, physics, quantitative finance, mathematics. Use when the user asks what the research says, wants papers on something, or is studying a technical subject. Returns titles, authors and abstracts. Prefer this over web search for anything academic: the web returns blog posts about papers, this returns the papers.",
    inputSchema: z.object({
      query: z.string().max(200).describe("Topic, or arXiv field syntax like au:Bengio or cat:q-fin.PM"),
      recent: z.boolean().optional().describe("True to sort by newest rather than relevance"),
    }),
    execute: async ({ query, recent }) => {
      const { searchPapers, cite } = await import("@/infrastructure/integrations/arxiv");
      const papers = await searchPapers(query, { limit: 6, sortBy: recent ? "recent" : "relevance" });
      if (papers === null) return { ok: false, error: "arXiv didn't answer." };
      if (papers.length === 0) return { ok: true, count: 0, note: "Nothing on arXiv for that." };
      return {
        ok: true,
        count: papers.length,
        papers: papers.map((p) => ({
          id: p.id,
          title: p.title,
          published: p.published.slice(0, 10),
          // Trimmed: six full abstracts is most of a context window, and the
          // first few sentences are what decide whether to open it.
          abstract: p.summary.slice(0, 600),
          citation: cite(p),
          url: p.url,
        })),
      };
    },
  }),

  save_paper: tool({
    description:
      "Save an arXiv paper into the knowledge base by its id (e.g. 2401.01234), so its full text becomes searchable and citable later. Use after find_papers when the user says to keep or read one.",
    inputSchema: z.object({ id: z.string().max(40) }),
    execute: async ({ id }) => {
      const { getPaper, cite } = await import("@/infrastructure/integrations/arxiv");
      const paper = await getPaper(id);
      if (!paper) return { ok: false, error: "No paper with that id." };

      const { proxyFetch } = await import("@/infrastructure/http/fetch");
      const { ingestPdf } = await import("@/core/knowledge/ingest");
      try {
        const res = await proxyFetch(paper.pdfUrl, { redirect: "follow", signal: AbortSignal.timeout(40_000) });
        if (!res.ok) return { ok: false, error: `arXiv returned ${res.status} for the PDF.` };
        const source = await ingestPdf(Buffer.from(await res.arrayBuffer()), `${paper.title.replace(/[^\w\s-]/g, "").slice(0, 80)}.pdf`);
        return { ok: true, saved: paper.title, citation: cite(paper), source };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
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
