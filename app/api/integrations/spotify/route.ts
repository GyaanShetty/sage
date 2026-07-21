import { NextResponse } from "next/server";
import { spotifyAuthUrl } from "@/infrastructure/integrations/spotify";

export async function GET() {
  if (!process.env.SPOTIFY_CLIENT_ID) {
    return NextResponse.json({ ok: false, error: "Spotify not configured" }, { status: 400 });
  }
  return NextResponse.redirect(spotifyAuthUrl());
}
