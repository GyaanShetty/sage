import { NextResponse } from "next/server";
import { proxyFetch } from "@/infrastructure/http/fetch";

export const revalidate = 900;

/** Latest conflict-related headlines worldwide (GDELT DOC, keyless). */
export async function GET() {
  try {
    const q = encodeURIComponent("(airstrike OR clashes OR offensive OR shelling OR militants OR ceasefire)");
    const res = await proxyFetch(
      `https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=artlist&format=json&maxrecords=15&sort=datedesc&timespan=24h`,
      { signal: AbortSignal.timeout(9000) },
    );
    if (!res.ok) return NextResponse.json({ ok: true, data: [] });
    const j = (await res.json()) as { articles?: { title: string; url: string; domain?: string; seendate?: string }[] };
    const data = (j.articles ?? [])
      .filter((a) => a.title)
      .slice(0, 12)
      .map((a) => ({ title: a.title, url: a.url, source: a.domain ?? "" }));
    return NextResponse.json({ ok: true, data }, { headers: { "cache-control": "public, max-age=900" } });
  } catch {
    return NextResponse.json({ ok: true, data: [] });
  }
}
