import { NextResponse } from "next/server";
import { getNowPlaying, spotifyControl, spotifyPlaySearch } from "@/infrastructure/integrations/spotify";

export async function GET() {
  const data = await getNowPlaying();
  return NextResponse.json({ ok: true, data });
}

export async function POST(req: Request) {
  const { action, query } = (await req.json()) as { action?: string; query?: string };
  if (action === "playSearch" && query) {
    const ok = await spotifyPlaySearch(query);
    return NextResponse.json({ ok: !!ok });
  }
  if (["play", "pause", "next", "previous"].includes(action ?? "")) {
    const ok = await spotifyControl(action as "play" | "pause" | "next" | "previous");
    return NextResponse.json({ ok: !!ok });
  }
  return NextResponse.json({ ok: false, error: "Invalid action" }, { status: 400 });
}
