import { NextResponse } from "next/server";
import { proxyFetch } from "@/infrastructure/http/fetch";

export const revalidate = 3600;

/** Raw TLEs from Celestrak; the client propagates positions with satellite.js. */
export async function GET(req: Request) {
  const group = new URL(req.url).searchParams.get("group") ?? "stations";
  const safe = /^[a-z-]+$/i.test(group) ? group : "stations";
  try {
    const res = await proxyFetch(
      `https://celestrak.org/NORAD/elements/gp.php?GROUP=${safe}&FORMAT=tle`,
      { signal: AbortSignal.timeout(9000) },
    );
    if (!res.ok) return NextResponse.json({ ok: true, data: [] });
    const text = await res.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const sats: { name: string; l1: string; l2: string }[] = [];
    for (let i = 0; i + 2 < lines.length + 1; i += 3) {
      if (lines[i] && lines[i + 1]?.startsWith("1 ") && lines[i + 2]?.startsWith("2 ")) {
        sats.push({ name: lines[i].trim(), l1: lines[i + 1], l2: lines[i + 2] });
      }
    }
    // cap to keep the client light
    return NextResponse.json({ ok: true, data: sats.slice(0, 60) }, { headers: { "cache-control": "public, max-age=3600" } });
  } catch {
    return NextResponse.json({ ok: true, data: [] });
  }
}
