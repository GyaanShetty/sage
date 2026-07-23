import { NextResponse } from "next/server";
import { proxyFetch } from "@/infrastructure/http/fetch";

export const revalidate = 86400;

/** Find the best real 3D model on Sketchfab for a topic (free, no key, embeddable). */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ ok: false, error: "q required" }, { status: 400 });
  try {
    const res = await proxyFetch(
      `https://api.sketchfab.com/v3/search?type=models&q=${encodeURIComponent(q)}&sort_by=-likeCount&count=12`,
      { signal: AbortSignal.timeout(9000) },
    );
    if (!res.ok) return NextResponse.json({ ok: true, data: null });
    const j = (await res.json()) as {
      results?: { uid: string; name: string; user?: { username?: string }; viewerUrl?: string; isAgeRestricted?: boolean; thumbnails?: { images?: { url: string; width: number }[] } }[];
    };
    // prefer non-restricted; take the most-liked.
    const pick = (j.results ?? []).find((m) => !m.isAgeRestricted) ?? j.results?.[0];
    if (!pick) return NextResponse.json({ ok: true, data: null });
    const thumb = (pick.thumbnails?.images ?? []).sort((a, b) => b.width - a.width)[0]?.url ?? null;
    return NextResponse.json(
      { ok: true, data: { uid: pick.uid, name: pick.name, author: pick.user?.username ?? "", viewerUrl: pick.viewerUrl, thumb } },
      { headers: { "cache-control": "public, max-age=86400" } },
    );
  } catch {
    return NextResponse.json({ ok: true, data: null });
  }
}
