/**
 * Finding the things in a mailbox that are actually opportunities.
 *
 * This is the reason Outlook was wanted: internship mail, application forms and
 * interview invitations arrive there and get lost, and the ones with deadlines
 * are exactly the ones that must not be.
 *
 * ── Why this is rules and not a model ──────────────────────────────────────
 *
 * Every fact here — the link, the date, the sender — is *extracted* from the
 * message rather than generated about it. A model asked "what is the deadline"
 * will answer even when there is no deadline, and a hallucinated deadline in a
 * career tracker is worse than no tracker at all: it is a wrong answer that
 * looks exactly like a right one, and it will be believed.
 *
 * A model may later be used to summarise or prioritise these. It must not be
 * used to invent their contents.
 */

export interface MailLike {
  id: string;
  subject: string;
  from: string;
  fromName?: string;
  body?: string;
  preview?: string;
  receivedAt: string;
}

export type Kind = "internship" | "form" | "interview" | "deadline";

export interface Opportunity {
  id: string;
  kinds: Kind[];
  subject: string;
  from: string;
  receivedAt: string;
  /** Links found in the body, application/form links first. */
  links: string[];
  /** A date found in the text, ISO. Null when the message states none. */
  deadline: string | null;
  /** 0..1. How strongly this looks like a real opportunity. */
  score: number;
}

const RX = {
  internship: /\b(internship|intern\b|traineeship|summer analyst|graduate programme|graduate program)\b/i,
  form: /\b(application form|apply (now|here|via)|registration (form|link)|google form|typeform|lever\.co|greenhouse\.io|workday)\b/i,
  interview: /\b(interview|assessment|online test|coding round|shortlist(ed)?|selected for)\b/i,
  deadline: /\b(deadline|last date|closes on|apply by|submit by|before)\b/i,
  /** Bulk mail that merely mentions the word. */
  marketing: /\b(unsubscribe|newsletter|promotional|no-?reply@.*(marketing|campaign)|webinar series)\b/i,
};

/** Links that look like somewhere you apply, ranked above ordinary ones. */
const APPLY_HOST = /(forms\.gle|docs\.google\.com\/forms|typeform|lever\.co|greenhouse\.io|workday|smartrecruiters|naukri|linkedin\.com\/jobs|internshala)/i;

/**
 * Dates, in the formats mail actually uses.
 *
 * Deliberately conservative: an unparseable date yields null rather than a
 * guess. "No deadline found" is a fine answer; a wrong one is not.
 */
const DATE_PATTERNS: RegExp[] = [
  // 15 March 2026 · 15 Mar 2026 · 15th March 2026
  /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4})\b/i,
  // March 15, 2026 · Mar 15 2026
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i,
  // 2026-03-15
  /\b(\d{4})-(\d{2})-(\d{2})\b/,
];

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

export function findDeadline(text: string): string | null {
  // Only look near a deadline word. A date anywhere in a long email is very
  // often the date the email was sent, an event date, or a footer copyright.
  const near = text.match(
    /\b(?:deadline|last date|closes on|apply by|submit by|due (?:on|by))\b[^.\n]{0,80}/gi,
  );
  const haystacks = near?.length ? near : [];
  for (const h of haystacks) {
    for (const rx of DATE_PATTERNS) {
      const m = h.match(rx);
      if (!m) continue;
      let y: number, mo: number, d: number;
      if (rx === DATE_PATTERNS[0]) { d = +m[1]; mo = MONTHS[m[2].toLowerCase().slice(0, 3)]; y = +m[3]; }
      else if (rx === DATE_PATTERNS[1]) { mo = MONTHS[m[1].toLowerCase().slice(0, 3)]; d = +m[2]; y = +m[3]; }
      else { y = +m[1]; mo = +m[2] - 1; d = +m[3]; }
      if (mo === undefined || Number.isNaN(y) || Number.isNaN(d)) continue;
      const dt = new Date(Date.UTC(y, mo, d));
      if (Number.isNaN(dt.getTime())) continue;
      return dt.toISOString().slice(0, 10);
    }
  }
  return null;
}

export function extractLinks(body: string): string[] {
  const found = body.match(/https?:\/\/[^\s"'<>)\]]+/g) ?? [];
  const seen = new Set<string>();
  const links = found
    .map((u) => u.replace(/[.,;]+$/, ""))
    .filter((u) => (seen.has(u) ? false : (seen.add(u), true)));
  // Somewhere you apply beats somewhere you read about applying.
  return links.sort((a, b) => Number(APPLY_HOST.test(b)) - Number(APPLY_HOST.test(a)));
}

export function classify(mail: MailLike): Opportunity | null {
  const body = mail.body ?? mail.preview ?? "";
  const text = `${mail.subject}\n${body}`;

  const kinds: Kind[] = [];
  if (RX.internship.test(text)) kinds.push("internship");
  if (RX.form.test(text)) kinds.push("form");
  if (RX.interview.test(text)) kinds.push("interview");

  const deadline = findDeadline(text);
  if (deadline) kinds.push("deadline");

  if (kinds.length === 0) return null;

  const links = extractLinks(body);

  /**
   * Scoring, so a mailing list that says "internship" once does not sit
   * alongside a real invitation.
   *
   * An interview or a dated deadline is strong evidence on its own; an apply
   * link is corroboration; bulk-mail markers count against. The caller decides
   * the cut, but nothing is silently discarded here — a low score is still
   * returned, labelled.
   */
  let score = 0.3;
  if (kinds.includes("interview")) score += 0.35;
  if (kinds.includes("deadline")) score += 0.25;
  if (kinds.includes("internship")) score += 0.15;
  if (links.some((l) => APPLY_HOST.test(l))) score += 0.2;
  if (RX.marketing.test(text)) score -= 0.35;

  return {
    id: mail.id,
    kinds,
    subject: mail.subject,
    from: mail.fromName || mail.from,
    receivedAt: mail.receivedAt,
    links: links.slice(0, 4),
    deadline,
    score: Math.max(0, Math.min(1, Number(score.toFixed(2)))),
  };
}

/** Everything worth surfacing, most urgent first. */
export function findOpportunities(mail: MailLike[], minScore = 0.45): Opportunity[] {
  return mail
    .map(classify)
    .filter((o): o is Opportunity => !!o && o.score >= minScore)
    .sort((a, b) => {
      // A dated deadline outranks everything, soonest first.
      if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return b.score - a.score || b.receivedAt.localeCompare(a.receivedAt);
    });
}
