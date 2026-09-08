/**
 * A read on the situation, on top of the facts.
 *
 * The sitrep is a list of true things — six overdue tasks, an event in forty
 * minutes, BTC down seven percent — and a list is not a judgement. It never
 * says which of them matters, or what they mean *together*: that the OA closes
 * Friday and Thursday is already booked solid is a fact about two lines, and no
 * rule in the strip can see across them.
 *
 * So: the rules produce the facts, and a model writes one or two sentences
 * about them. The split is the whole design.
 *
 *   · Every number, name and date comes from the rules. The model is given the
 *     lines and forbidden to add any fact that is not in them — a sitrep is a
 *     thing you act on, and an invented deadline here would be acted on.
 *   · It is allowed to do exactly what the rules cannot: rank, connect, and
 *     say what to do next.
 *   · When there is no model, or the quota is gone, or it takes too long, the
 *     read is simply absent and the strip is what it was before. Nothing about
 *     the facts depends on it.
 */

import { generateText } from "ai";
import { getModel } from "@/infrastructure/llm";
import { OWNER } from "@/lib/config";
import { within } from "@/lib/budget";

export interface ReadableLine { level: string; text: string }

const SYSTEM =
  `You are SAGE, ${OWNER}'s chief of staff, glancing at his status board and saying what you make of it. ` +
  "One or two short sentences, spoken plainly, no markdown and no lists. " +
  "Say which line matters most and what he should do in the next hour, or connect two lines that are related. " +
  "Use ONLY the facts given: never introduce a number, name, time or deadline that is not in them, and never soften or inflate one. " +
  "If the lines say nothing is pressing, say so in a sentence and stop — do not manufacture urgency, and do not invent work to fill the silence.";

/**
 * The key a cached read is stored under.
 *
 * Content-addressed rather than time-addressed: the read is regenerated when
 * the facts change, not on a timer. Polling the strip every thirty seconds
 * while nothing moves must not cost a model call every thirty seconds.
 */
export function readKey(lines: ReadableLine[]): string {
  return lines.map((l) => `${l.level}:${l.text}`).join("|");
}

const cache = new Map<string, string>();

export async function readSitrep(lines: ReadableLine[], budgetMs = 4_000): Promise<string | null> {
  if (!lines.length) return null;

  const key = readKey(lines);
  const hit = cache.get(key);
  if (hit !== undefined) return hit || null;

  const model = getModel("fast");
  if (!model) return null;

  const prompt = lines.map((l) => `[${l.level}] ${l.text}`).join("\n");
  const text = await within(
    generateText({ model, system: SYSTEM, prompt: `The board says:\n${prompt}` })
      .then((r) => r.text.trim())
      .catch(() => ""),
    budgetMs,
    "",
  );

  // One entry per distinct board state; the board has few of them in a day,
  // and a warm instance is the only thing this needs to survive.
  if (cache.size > 40) cache.clear();
  cache.set(key, text);
  return text || null;
}
