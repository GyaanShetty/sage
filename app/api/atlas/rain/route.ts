import { NextResponse } from "next/server";
import { proxyFetch } from "@/infrastructure/http/fetch";

export const revalidate = 300;

/** Latest global radar frame from RainViewer (free, no key). */
export async function GET() {
  try {
    const res = await proxyFetch("https://api.rainviewer.com/public/weather-maps.json", { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return NextResponse.json({ ok: true, data: null });
    const j = (await res.json()) as { host: string; radar?: { past?: { path: string }[] } };
    const frames = j.radar?.past ?? [];
    const latest = frames.length ? frames[frames.length - 1].path : null;
    if (!latest) return NextResponse.json({ ok: true, data: null });
    // Leaflet tile template. color=4 (Universal Blue), smooth=1, snow=1.
    return NextResponse.json(
      { ok: true, data: { url: `${j.host}${latest}/256/{z}/{x}/{y}/4/1_1.png` } },
      { headers: { "cache-control": "public, max-age=300" } },
    );
  } catch {
    return NextResponse.json({ ok: true, data: null });
  }
}
