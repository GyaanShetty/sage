import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/infrastructure/llm";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { getSourceHeadlines, NEWS_SOURCES } from "@/infrastructure/news";
import { TZ, tzHour, OWNER } from "@/lib/config";

export const maxDuration = 45;
export const dynamic = "force-dynamic";

/**
 * One publication, read for you.
 *
 * The synthesis at the end of the block ties everything together, which is the
 * right thing at the end and the wrong thing while you are still reading. This
 * is the other altitude: what THIS paper is leading with this morning, before
 * you have opened a single article. Per source, so the FT's angle and
 * CoinDesk's stay distinguishable rather than being blended into one voice.
 *
 * Cached per source per half-day, like the synthesis, because the feeds do not
 * turn over faster than that and the quota is finite.
 */

const TYPE = "feed.digest";

const schema = z.object({
  gist: z.string().describe("2-3 sentences: what this publication is leading with today and why it matters"),
  themes: z.array(z.string()).describe("The 2-4 threads running through today's headlines, each a short phrase"),
  mustRead: z.string().describe("The exact title of the single headline worth opening, copied verbatim from the list"),
  skip: z.string().describe("One honest line on what is noise today. Say 'nothing obvious' if it is all worth a look."),
});

export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("source") ?? "";
  const src = NEWS_SOURCES[key];
  if (!src) return NextResponse.json({ ok: false, error: "unknown source" }, { status: 400 });

  const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const bucket = `${day}-${tzHour() < 13 ? "AM" : "PM"}-${key}`;

  const { data: cached } = await db
    .from("Event")
    .select("payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE)
    .eq("payload->>bucket", bucket)
    .limit(1)
    .maybeSingle();
  const cp = cached?.payload as { data?: unknown } | null;
  if (cp?.data) return NextResponse.json({ ok: true, data: cp.data, cached: true });

  const items = await getSourceHeadlines(key, 10).catch(() => []);
  if (items.length < 2) {
    return NextResponse.json({ ok: true, data: null, reason: "not enough headlines to summarise" });
  }

  const model = getModel("fast");
  if (!model) return NextResponse.json({ ok: true, data: null, reason: "no model available" });

  try {
    const { object } = await generateObject({
      model,
      schema,
      system:
        `You are SAGE, reading ${src.source} on ${OWNER}'s behalf before he opens it. ` +
        "Summarise what THIS publication is leading with — its angle, not a neutral wire report. " +
        "Be specific: name companies, numbers and places from the headlines. " +
        "mustRead must be copied verbatim from the supplied titles, never invented or paraphrased. " +
        "No hedging, no 'it is important to note'.",
      prompt: `${src.source} headlines right now:\n${items.map((h, i) => `${i + 1}. ${h.title}`).join("\n")}`,
    });

    // The model is asked to copy a title verbatim and usually does; when it
    // paraphrases, match it back to a real headline so the link works. A
    // "must read" that points at nothing is worse than not offering one.
    const exact = items.find((h) => h.title === object.mustRead);
    const fuzzy = exact ?? items.find((h) =>
      h.title.toLowerCase().includes(object.mustRead.toLowerCase().slice(0, 25)),
    );

    const data = {
      ...object,
      mustRead: fuzzy?.title ?? items[0].title,
      mustReadLink: fuzzy?.link ?? items[0].link,
      source: src.source,
      count: items.length,
    };

    await db.from("Event").insert({
      id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: TYPE, payload: { bucket, data },
    });
    return NextResponse.json({ ok: true, data });
  } catch {
    return NextResponse.json({ ok: true, data: null, reason: "the model couldn't summarise that one" });
  }
}
