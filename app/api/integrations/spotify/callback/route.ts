import { NextResponse } from "next/server";
import { exchangeSpotifyCode, saveSpotifyTokens } from "@/infrastructure/integrations/spotify";
import { appUrl } from "@/infrastructure/integrations/google";
import { ensureDefaultUser } from "@/infrastructure/db/supabase";

export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code");
  if (!code) return NextResponse.redirect(`${appUrl()}/settings?spotify=denied`);
  try {
    await ensureDefaultUser();
    const tokens = await exchangeSpotifyCode(code);
    await saveSpotifyTokens(tokens);
    return NextResponse.redirect(`${appUrl()}/dashboard?spotify=connected`);
  } catch (err) {
    console.error("[spotify] callback failed:", err);
    return NextResponse.redirect(`${appUrl()}/settings?spotify=error`);
  }
}
