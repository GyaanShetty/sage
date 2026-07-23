import { NextResponse } from "next/server";
import { generateText } from "ai";
import { getModel } from "@/infrastructure/llm";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { listUnreadEmails, listUpcomingEvents } from "@/infrastructure/integrations/google";
import { getMarkets } from "@/infrastructure/markets";
import { TZ, tzHour } from "@/lib/config";

export const maxDuration = 60;

function greeting(): string {
  const h = tzHour();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Good evening"; // late night still reads as evening for a briefing
}

/** Spoken boot debrief: greeting + what matters now. Cached per half-day so
 *  it doesn't burn quota on every reload. */
export async function GET(req: Request) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const bucket = `${day}-${tzHour() < 13 ? "AM" : "PM"}`;

  const { data: cached } = await db
    .from("Event")
    .select("payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", "debrief.generated")
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  const cp = cached?.payload as { bucket?: string; text?: string } | null;
  if (cp?.bucket === bucket && cp.text) {
    return NextResponse.json({ ok: true, data: { text: cp.text } });
  }

  const model = getModel("fast");

  const [{ data: tasks }, events, emails, markets] = await Promise.all([
    db
      .from("Task")
      .select("title, dueAt, priority")
      .eq("userId", DEFAULT_USER_ID)
      .in("status", ["todo", "doing"])
      .order("priority")
      .limit(8),
    listUpcomingEvents(4).catch(() => null),
    listUnreadEmails(5).catch(() => null),
    getMarkets().catch(() => null),
  ]);

  const symbols = new URL(req.url).searchParams.get("symbols") ?? "^NSEI,^BSESN";
  const origin = new URL(req.url).origin;
  const quotes = await fetch(`${origin}/api/market/quotes?symbols=${encodeURIComponent(symbols)}`, {
    headers: { cookie: req.headers.get("cookie") ?? "" },
  })
    .then((r) => r.json())
    .then((j) => j.data ?? [])
    .catch(() => []);

  const g = greeting();

  // Deterministic fallback if the model is unavailable / quota spent.
  const fallback = (() => {
    const openN = (tasks ?? []).length;
    const mailN = (emails ?? []).length;
    const bits = [`${g}, sir.`];
    bits.push(openN ? `You have ${openN} open ${openN === 1 ? "task" : "tasks"}.` : `Your task list is clear.`);
    if (mailN) bits.push(`${mailN} unread ${mailN === 1 ? "email" : "emails"} waiting.`);
    const nifty = (quotes as { name: string; changePct: number }[]).find((q) => /nifty/i.test(q.name));
    if (nifty) bits.push(`The Nifty is ${nifty.changePct >= 0 ? "up" : "down"} ${Math.abs(nifty.changePct).toFixed(1)} percent.`);
    return bits.join(" ");
  })();

  if (!model) return NextResponse.json({ ok: true, data: { text: fallback } });

  try {
    const { text } = await generateText({
      model,
      prompt: `You are SAGE, Gyaan's distinguished British AI chief of staff — a refined elder gentleman with a deep, calm baritone — delivering a short SPOKEN briefing as he opens his console. This is read ALOUD, so: no markdown, no lists, no headers, no URLs. Start with exactly "${g}, sir." then in 3 to 5 short flowing sentences cover, in this order and only what's non-empty: his open tasks (call out the most important one), any pending important emails (who from / what about), his next calendar event if soon, and a one-line market read (Nifty/Sensex direction). Refined, composed, quietly confident; dry wit in moderation. End with one short forward-looking line like "Shall we begin, sir?" or "I stand ready." Keep it under 90 words.

Time: ${new Date().toString()} IST
Open tasks: ${JSON.stringify(tasks ?? [])}
Upcoming events: ${JSON.stringify(events ?? [])}
Unread emails: ${JSON.stringify((emails ?? []).map((e) => ({ from: e.from, subject: e.subject })))}
Indices: ${JSON.stringify((quotes as { name: string; changePct: number }[]).map((q) => ({ name: q.name, pct: q.changePct })))}
Crypto: ${JSON.stringify((markets ?? []).slice(0, 2).map((c) => ({ s: c.symbol, chg: c.change24h })))}`,
    });

    await db.from("Event").insert({
      id: crypto.randomUUID(),
      userId: DEFAULT_USER_ID,
      type: "debrief.generated",
      payload: { bucket, text },
    });
    return NextResponse.json({ ok: true, data: { text } });
  } catch {
    return NextResponse.json({ ok: true, data: { text: fallback } });
  }
}
