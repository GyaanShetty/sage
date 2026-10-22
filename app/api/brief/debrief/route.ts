import { NextResponse } from "next/server";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { TZ, startOfTodayUtc } from "@/lib/config";
import { briefBucket, cachedDebrief, generateDebrief } from "@/core/brief/debrief";

export const maxDuration = 60;

/** Spoken boot debrief: greeting + what matters now. Cached per half-day so
 *  it doesn't burn quota on every reload. */
export async function GET(req: Request) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const bucket = briefBucket();
  const claim = new URL(req.url).searchParams.get("claim") === "1";

  // Once-per-day, across ALL devices: the first device to open SAGE today
  // claims the spoken debrief; every other device/reload gets nothing.
  if (claim) {
    const { data: played } = await db
      .from("Event")
      .select("id")
      .eq("userId", DEFAULT_USER_ID)
      .eq("type", "debrief.played")
      .gte("createdAt", startOfTodayUtc())
      .limit(1)
      .maybeSingle();
    if (played) return NextResponse.json({ ok: true, data: { text: null, played: true } });
    // stake the claim immediately so a second device loading now won't also play
    await db.from("Event").insert({ id: crypto.randomUUID(), userId: DEFAULT_USER_ID, type: "debrief.played", payload: { day } });
  }

  const cached = await cachedDebrief(bucket);
  if (cached) return NextResponse.json({ ok: true, data: { text: cached } });

  const symbols = new URL(req.url).searchParams.get("symbols") ?? "^NSEI,^BSESN";
  return NextResponse.json({ ok: true, data: { text: await generateDebrief(symbols) } });
}

