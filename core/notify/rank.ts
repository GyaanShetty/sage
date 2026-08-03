import { generateText } from "ai";
import { getModel } from "@/infrastructure/llm";
import { sendPush } from "@/infrastructure/push";
import type { DayPicture } from "@/core/brief/agenda";

/**
 * Deciding what is worth interrupting you for.
 *
 * Every channel used to send the moment its own condition held, so a single
 * cron tick could fire six separate pushes — morning brief, markets, tasks,
 * two emails, a LeetCode nudge — one after another. Six notifications at once
 * is not six times the signal; it is a wall of banners you swipe away without
 * reading, and after a week you stop reading any of them.
 *
 * So candidates are now scored and ranked, and only the best few are sent.
 * The rest are folded into a trailing clause of the top one, which means
 * nothing is silently dropped — it just stops arriving as a separate buzz.
 */

export interface Candidate {
  /** Dedupe key, stored once sent. */
  key: string;
  /** 0-100. Above SEND_FLOOR is worth a push; the top one wins the headline. */
  score: number;
  title: string;
  body: string;
  url: string;
  /** Short phrase for folding into another notification: "3 tasks overdue". */
  digest: string;
}

/** Below this, it is not worth a banner. */
export const SEND_FLOOR = 30;
/** Never more than this many separate pushes from one tick. */
export const MAX_PUSHES = 2;

/**
 * Rank, then send.
 *
 * Returns the keys actually sent so the caller can mark them — and only
 * those, because a candidate folded into someone else's footer has not been
 * properly delivered and should be free to come back tomorrow.
 */
export async function dispatch(
  candidates: Candidate[],
  picture: DayPicture | null,
): Promise<{ sent: string[]; folded: string[] }> {
  const worthy = candidates
    .filter((c) => c.score >= SEND_FLOOR)
    .sort((a, b) => b.score - a.score);

  if (worthy.length === 0) return { sent: [], folded: [] };

  const head = worthy.slice(0, MAX_PUSHES);
  const tail = worthy.slice(MAX_PUSHES);

  // Only the leader gets rewritten. Spending a model call on the second
  // banner is not worth the quota, and the deterministic body is already
  // specific — it just reads like a template.
  const lead = head[0];
  const rewritten = await compose(lead, tail, picture).catch(() => null);

  const sent: string[] = [];
  for (const [i, c] of head.entries()) {
    const body =
      i === 0
        ? rewritten ?? withFooter(c.body, tail)
        : c.body;
    const ok = await sendPush({ title: c.title, body, tag: c.key.slice(0, 60), url: c.url }).catch(() => 0);
    if (ok) sent.push(c.key);
  }

  return { sent, folded: tail.map((c) => c.key) };
}

/** Deterministic fold — used when there is no model, and as the fallback. */
function withFooter(body: string, tail: Candidate[]): string {
  const extra = digests(tail);
  if (!extra.length) return body;
  return `${body} Also: ${extra.join(", ")}.`;
}

/**
 * The folded items, deduplicated.
 *
 * Channels overlap: the morning brief and the evening task brief both
 * summarise as "1 overdue", so a naive join produced "Also: 1 overdue, 1
 * overdue" — which reads like a bug, because it is one.
 */
function digests(tail: Candidate[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of tail) {
    const norm = c.digest.trim().toLowerCase();
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(c.digest);
    if (out.length === 3) break;
  }
  return out;
}

/**
 * Rewrite the leading notification as one sentence a person would say.
 *
 * Push bodies are read in a fraction of a second on a lock screen, so the
 * constraint is severe: under 140 characters, the most important thing first,
 * no greeting, no padding. The deterministic body is passed in as the floor —
 * if the model cannot beat it, we keep it.
 */
async function compose(lead: Candidate, tail: Candidate[], picture: DayPicture | null): Promise<string | null> {
  const model = getModel("fast");
  if (!model) return null;

  const { text } = await generateText({
    model,
    system:
      "You write phone notifications for SAGE, the user's chief of staff. " +
      "One sentence, under 140 characters, read at a glance on a lock screen. " +
      "Most important fact first, with its real number or name. " +
      "No greeting, no emoji, no lead-in like 'Just a reminder'. Dry and direct. " +
      "If a second item is supplied, add it as a short trailing clause only if it fits.",
    prompt: [
      `Main: ${lead.body}`,
      digests(tail).length ? `Also worth a mention: ${digests(tail).join("; ")}` : "",
      picture ? `Context — ${picture.overdue.length} overdue, ${picture.dueToday.length} due today, day is ${picture.load}.` : "",
      "Write the notification body only.",
    ].filter(Boolean).join("\n"),
  });

  const clean = text.trim().replace(/^["']|["']$/g, "").split("\n")[0];
  // A model that ignores the length limit is worse than the template it was
  // meant to improve on, so it does not get to win by default.
  if (!clean || clean.length > 200) return null;
  return clean;
}
