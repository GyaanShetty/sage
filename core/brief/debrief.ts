/**
 * The spoken briefing, as a function rather than only as a route.
 *
 * It lived entirely inside the GET handler, which meant the only way to get
 * a briefing was for a browser to ask for one — and the only thing that
 * ever asked was a component that runs at boot. So the debrief pane on the
 * wall said "no briefings recorded yet" indefinitely: nothing scheduled
 * could produce one, because producing one required a request.
 *
 * Lifted here so the heartbeat can write the morning and evening briefs
 * whether or not anyone has the tab open, which is the whole difference
 * between a briefing and a thing you can go and generate.
 *
 * The quotes are fetched through the same module the quotes route uses
 * rather than by the server calling its own HTTP endpoint. A serverless
 * function fetching its own origin is a second cold start, a second
 * invocation billed, and a request that needs the caller's cookie to get
 * past the app gate — none of which exist on a cron.
 */

import { generateText } from "ai";
import { getModel } from "@/infrastructure/llm";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { TZ, tzHour, OWNER } from "@/lib/config";
import { getNews } from "@/infrastructure/news";
import { recentBriefs, noRepeatClause } from "./variety";
import { buildDayPicture, describeDay } from "./agenda";
import { fetchQuote, type Quote } from "@/infrastructure/markets/quotes";

export function greeting(): string {
  const h = tzHour();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Good evening"; // late night still reads as evening for a briefing
}

/** The half-day a briefing belongs to, so one is not written twice. */
export function briefBucket(): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  return `${day}-${tzHour() < 13 ? "AM" : "PM"}`;
}

export async function cachedDebrief(bucket: string): Promise<string | null> {
  const { data } = await db
    .from("Event").select("payload")
    .eq("userId", DEFAULT_USER_ID).eq("type", "debrief.generated")
    .order("createdAt", { ascending: false }).limit(1).maybeSingle();
  const p = data?.payload as { bucket?: string; text?: string } | null;
  return p?.bucket === bucket && p.text ? p.text : null;
}

export async function generateDebrief(symbols = "^NSEI,^BSESN"): Promise<string> {
  const bucket = briefBucket();
  const model = getModel("fast");

  const [picture, headlines, previous] = await Promise.all([
    buildDayPicture(),
    getNews(8).catch(() => []),
    recentBriefs("debrief.generated", 4),
  ]);
  const emails = picture.unread;

  const quotes = (await Promise.all(
    symbols.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 8).map((s) => fetchQuote(s).catch(() => null)),
  )).filter((q): q is Quote => q !== null);

  const g = greeting();

  // Deterministic fallback if the model is unavailable / quota spent. It reads
  // the same agenda the model would, so a quota-spent morning still gets a
  // real briefing rather than a bare headcount.
  const fallback = (() => {
    const bits = [`${g}, sir.`];

    if (picture.next?.startsAt) {
      const at = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(picture.next.startsAt));
      bits.push(`First up is ${picture.next.summary} at ${at}${picture.load === "packed" ? ", and the day is packed from there" : ""}.`);
    } else {
      bits.push("Nothing in the calendar today — the day is your own.");
    }

    // openCount, not tasks.length: the task list is capped at a dozen for the
    // prompt, and reporting that cap as the total would quietly undercount.
    if (picture.overdue.length) {
      const worst = picture.overdue[0];
      bits.push(`${picture.overdue.length} ${picture.overdue.length === 1 ? "task is" : "tasks are"} overdue — ${worst.title}, by ${worst.overdueDays} ${worst.overdueDays === 1 ? "day" : "days"}.`);
    } else if (picture.dueToday.length) {
      bits.push(`${picture.dueToday.length} due today, starting with ${picture.dueToday[0].title}.`);
    } else if (picture.openCount) {
      bits.push(`${picture.openCount} open ${picture.openCount === 1 ? "task" : "tasks"}, nothing overdue.`);
    } else {
      bits.push("Your task list is clear.");
    }

    // The fallback speaks when there is no model, so it too names mail rather
    // than counting it — a brief that only ever says "four unread" is the
    // thing this whole change exists to remove.
    if (picture.importantMail.length) {
      const m = picture.importantMail[0];
      bits.push(`In your mail: ${m.from} on ${m.subject}.`);
      if (picture.importantMail.length > 1) {
        bits.push(`And ${picture.importantMail.length - 1} more worth a look.`);
      }
    } else if (emails.length) {
      bits.push(`${emails.length} unread ${emails.length === 1 ? "email" : "emails"}, none of them pressing.`);
    }

    const nifty = quotes.find((q) => /nifty/i.test(q.name));
    if (nifty) bits.push(`The Nifty is ${nifty.changePct >= 0 ? "up" : "down"} ${Math.abs(nifty.changePct).toFixed(1)} percent.`);
    return bits.join(" ");
  })();

  if (!model) return fallback;

  try {
    const { text } = await generateText({
      model,
      prompt: `You are SAGE, ${OWNER}'s distinguished British AI chief of staff — refined and brilliant but genuinely warm and full of character, never a stiff robot — delivering his morning briefing as he opens his console.

This is read ALOUD: no markdown, no lists, no headers, no URLs, no bullet characters. Say numbers as words a person would speak ("half past nine", "down three percent").

Open with exactly "${g}, sir." then brief him properly, in this order, skipping anything the notes below say is empty:
1. THE SHAPE OF THE DAY — how full it is and what the first commitment is, with its time. If the day is clear, say so; that is good news, not an absence.
2. WHAT NEEDS DOING — lead with the single item flagged "lead with this one". Name it. If something is overdue, say how long by, with a little dry exasperation if it has been sitting a while.
3. THE MARKETS — one honest line on his positions and the wider tape. Do not soften a loss.
4. THE MAIL — if anything is listed under "MAIL THAT NEEDS HIM", say who it is from and what it wants, in one line each, naming at most two. That is the whole reason he asked for this: a count of unread mail tells him nothing he did not already know. If nothing is listed, say the inbox has nothing pressing rather than listing what is in it.
5. ANYTHING ELSE THAT MATTERS — the weather if it would change his plans, a nudge if he has not trained in days.

Finish with one short characterful forward line, like "Shall we, sir?" or "Right then — let's make a dent."

Be specific: real times, real names, real numbers, all of which are below. Never say "you have several tasks" when you have been given the count and the titles. Keep it flowing and conversational — 100 to 150 words, six to nine sentences.

${describeDay(picture)}

INDICES: ${quotes.map((q) => `${q.name} ${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(1)}%`).join(", ") || "unavailable"}\n\nHeadlines this morning: ${headlines.slice(0, 6).map((h) => h.title).join(" | ") || "feeds quiet"}${noRepeatClause(previous, { fixedOpening: true })}`,
    });

    await db.from("Event").insert({
      id: crypto.randomUUID(),
      userId: DEFAULT_USER_ID,
      type: "debrief.generated",
      payload: { bucket, text },
    });
    return text;
  } catch {
    return fallback;
  }
}
