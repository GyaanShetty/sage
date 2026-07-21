import { NextResponse } from "next/server";
import { proxyFetch } from "@/infrastructure/http/fetch";

export interface Apod {
  title: string;
  url: string;
  explanation: string;
  date: string;
  copyright?: string;
}

// NASA APOD: DEMO_KEY works (50/day per IP) but a personal key from
// api.nasa.gov is instant and free — set NASA_API_KEY when you have one.
let cache: { day: string; apod: Apod | null } | null = null;

export async function GET() {
  const day = new Date().toISOString().slice(0, 10);
  if (cache?.day === day) return NextResponse.json({ ok: true, data: cache.apod });

  try {
    const key = process.env.NASA_API_KEY ?? "DEMO_KEY";
    const res = await proxyFetch(`https://api.nasa.gov/planetary/apod?api_key=${key}&thumbs=true`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const j = (await res.json()) as {
      title?: string;
      url?: string;
      thumbnail_url?: string;
      media_type?: string;
      explanation?: string;
      date?: string;
      copyright?: string;
    };
    const url = j.media_type === "video" ? j.thumbnail_url : j.url;
    const apod: Apod | null = url
      ? {
          title: j.title ?? "Astronomy Picture of the Day",
          url,
          explanation: (j.explanation ?? "").slice(0, 420),
          date: j.date ?? day,
          ...(j.copyright ? { copyright: j.copyright.trim() } : {}),
        }
      : null;
    cache = { day, apod };
    return NextResponse.json({ ok: true, data: apod });
  } catch {
    return NextResponse.json({ ok: true, data: cache?.apod ?? null });
  }
}
