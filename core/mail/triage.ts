/**
 * Which mail actually needs him — from both accounts, in one shape.
 *
 * SAGE has never told him what is in his inbox. It counted it: the day picture
 * pulled six Gmail subjects and the debrief said "four unread emails waiting",
 * which is a number he already knew and cannot act on. Outlook reached the
 * brief through exactly one path, a career-opportunity scan, and the morning
 * synthesis mentioned mail not at all.
 *
 * The pure half lives above the store import so it can be tested and reused
 * from anywhere — the same split core/places and core/feeds make, because the
 * db module drags Node built-ins into whatever imports it.
 */

export type MailAccount = "gmail" | "outlook";

export interface MailItem {
  id: string;
  account: MailAccount;
  /** The raw `Name <addr>` header, kept for display. */
  from: string;
  fromName: string;
  fromAddress: string;
  subject: string;
  preview: string;
  receivedAt: string | null;
  unread: boolean;
}

export type Urgency = "now" | "today" | "this-week" | "ignore";

export interface RankedMail {
  id: string;
  account: MailAccount;
  from: string;
  subject: string;
  /** One line: why this one matters. The reason is the point — a list of
   *  subjects is what the mailbox already shows. */
  why: string;
  urgency: Urgency;
}

/** `"Priya Sharma" <priya@x.com>` → name and address, either possibly empty. */
export function parseSender(raw: string): { name: string; address: string } {
  const text = (raw ?? "").trim();
  const angled = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(text);
  if (angled) return { name: angled[1].trim(), address: angled[2].trim().toLowerCase() };
  // A bare address, or a bare name with no address at all.
  return text.includes("@")
    ? { name: text.split("@")[0], address: text.toLowerCase() }
    : { name: text, address: "" };
}

/**
 * One message can arrive twice — the same thread reaching both accounts, or a
 * list he is on at two addresses. Deduped on sender address plus subject
 * rather than on message id, because the ids are per-provider and would never
 * collide however duplicated the mail is.
 */
export function dedupe(items: MailItem[]): MailItem[] {
  const seen = new Set<string>();
  const out: MailItem[] = [];
  for (const m of items) {
    const key = `${m.fromAddress}|${m.subject.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

/** Newest first, with undated mail last rather than pretending it is old. */
export function byNewest(items: MailItem[]): MailItem[] {
  return [...items].sort((a, b) => {
    if (!a.receivedAt) return 1;
    if (!b.receivedAt) return -1;
    return b.receivedAt.localeCompare(a.receivedAt);
  });
}

const NOREPLY = /(^|[.\-_])(no-?reply|donotreply|notifications?|mailer|bounce|newsletter|updates?)([.\-_@]|$)/i;
const URGENT = /\b(deadline|due|expires?|last date|final|today|tomorrow|asap|urgent|action required|reminder)\b/i;
const REAL = /\b(interview|offer|shortlist|selected|application|assessment|invoice|payment|result|exam|admit|scholarship|visa|appointment|meeting|schedule[d]?)\b/i;

/**
 * The ranker used when no model is available.
 *
 * Worse than the model, and the point is that a quota-exhausted morning still
 * names mail instead of going silent — a brief that says nothing about the
 * inbox is indistinguishable from an empty inbox, which is the one reading it
 * must never produce by accident.
 *
 * Deliberately conservative: it demotes rather than promotes. Anything from a
 * no-reply address falls to the bottom, and only words that genuinely imply an
 * obligation lift something up.
 */
export function rankByRules(items: MailItem[], limit = 5): RankedMail[] {
  const scored = items.map((m) => {
    const hay = `${m.subject} ${m.preview}`;
    let score = 0;
    if (NOREPLY.test(m.fromAddress)) score -= 3;
    if (URGENT.test(hay)) score += 2;
    if (REAL.test(hay)) score += 2;
    if (m.unread) score += 1;
    return { m, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || (b.m.receivedAt ?? "").localeCompare(a.m.receivedAt ?? ""))
    .slice(0, limit)
    .map(({ m, score }) => ({
      id: m.id,
      account: m.account,
      from: m.fromName || m.fromAddress,
      subject: m.subject,
      // Honest about its own confidence: this is a keyword match, and saying
      // so stops a guess reading like a judgement.
      why: URGENT.test(`${m.subject} ${m.preview}`)
        ? "Mentions a deadline."
        : "Looks like it needs a reply.",
      urgency: score >= 4 ? "today" : "this-week",
    }));
}

/** A compact line per message for the model, and for a spoken brief. */
export function describeMail(items: RankedMail[]): string {
  if (!items.length) return "Nothing in the inbox needs him.";
  return items
    .map((m) => `${m.account === "outlook" ? "Outlook" : "Gmail"} · ${m.from}: ${m.subject} — ${m.why}`)
    .join("\n");
}

/* ── gathering ────────────────────────────────────────────────────────────
   Below the pure half, because these pull in the providers and the db. */

import { listUnreadEmails } from "@/infrastructure/integrations/google";
import { listOutlookMail } from "@/infrastructure/integrations/outlook";
import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/infrastructure/llm";
import { OWNER } from "@/lib/config";

/**
 * Both accounts, in one shape.
 *
 * Either being absent returns nothing from that side rather than failing the
 * whole call — the same rule the day picture already applies to Outlook, since
 * a brief that will not generate because one mailbox is unconfigured is worse
 * than a brief that covers one mailbox.
 */
export async function gatherMail(perAccount = 15): Promise<MailItem[]> {
  const [gmail, outlook] = await Promise.all([
    listUnreadEmails(perAccount).catch(() => null),
    listOutlookMail(perAccount).catch(() => null),
  ]);

  const items: MailItem[] = [];

  for (const [i, e] of (gmail ?? []).entries()) {
    const { name, address } = parseSender(e.from);
    items.push({
      id: e.id ?? `gmail-${i}`,
      account: "gmail",
      from: e.from,
      fromName: name,
      fromAddress: address,
      subject: e.subject || "(no subject)",
      preview: e.snippet ?? "",
      // Gmail's metadata fetch does not ask for Date, so these sort last
      // rather than being given a time that is not theirs.
      receivedAt: null,
      unread: true,
    });
  }

  for (const m of outlook ?? []) {
    items.push({
      id: m.id,
      account: "outlook",
      from: m.fromName && m.from ? `${m.fromName} <${m.from}>` : m.from || m.fromName,
      fromName: m.fromName || m.from,
      fromAddress: (m.from ?? "").toLowerCase(),
      subject: m.subject || "(no subject)",
      preview: m.preview ?? "",
      receivedAt: m.receivedAt ?? null,
      unread: m.unread,
    });
  }

  return byNewest(dedupe(items));
}

const rankSchema = z.object({
  important: z.array(z.object({
    id: z.string().describe("The exact id given for the message"),
    why: z.string().describe("One short clause: why this needs him. No preamble."),
    urgency: z.enum(["now", "today", "this-week", "ignore"]),
  })).describe("Only the messages that genuinely need him. Empty if none do."),
});

/**
 * Rank with the model, falling back to rules.
 *
 * One call over subject, sender and preview — never the body. The preview is
 * enough to tell an interview invitation from a newsletter, and pulling forty
 * full bodies would cost forty requests and a context window for a judgement
 * that does not need them.
 */
export async function rankMail(items: MailItem[], limit = 5): Promise<RankedMail[]> {
  if (!items.length) return [];

  const model = getModel("fast");
  if (!model) return rankByRules(items, limit);

  const lines = items.map((m) =>
    `[${m.id}] (${m.account}) From: ${m.fromName || m.fromAddress} <${m.fromAddress}> — ${m.subject} :: ${m.preview.slice(0, 220)}`,
  ).join("\n");

  try {
    const { object } = await generateObject({
      model,
      schema: rankSchema,
      system:
        `You are SAGE, ${OWNER}'s chief of staff, triaging his inbox so he does not have to. ` +
        "Pick only mail that genuinely needs him: something asking him to act, a deadline, an interview or application, money, or a real person writing to him directly. " +
        "Marketing, newsletters, receipts, social notifications and automated digests are never important, however urgent their subject lines pretend to be. " +
        "Never invent a deadline that is not in the text. If nothing needs him, return an empty list — saying so is a useful answer.",
      prompt: `Messages:\n${lines}\n\nReturn at most ${limit}, most urgent first.`,
    });

    const byId = new Map(items.map((m) => [m.id, m]));
    return object.important
      .filter((r) => r.urgency !== "ignore" && byId.has(r.id))
      .slice(0, limit)
      .map((r) => {
        const m = byId.get(r.id)!;
        return {
          id: m.id, account: m.account,
          from: m.fromName || m.fromAddress,
          subject: m.subject,
          why: r.why, urgency: r.urgency,
        };
      });
  } catch {
    // A model that is over quota or having a bad minute must not take the
    // brief down with it.
    return rankByRules(items, limit);
  }
}
