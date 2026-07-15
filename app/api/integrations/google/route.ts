import { NextResponse } from "next/server";
import { googleAuthUrl } from "@/infrastructure/integrations/google";

/** Kick off the Google OAuth flow. */
export async function GET() {
  if (!process.env.GOOGLE_OAUTH_CLIENT_ID) {
    return NextResponse.json(
      { ok: false, error: "Google OAuth not configured (GOOGLE_OAUTH_CLIENT_ID missing)" },
      { status: 400 },
    );
  }
  return NextResponse.redirect(googleAuthUrl());
}
