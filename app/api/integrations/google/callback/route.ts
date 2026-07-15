import { NextResponse } from "next/server";
import { appUrl, exchangeCode, saveGoogleTokens } from "@/infrastructure/integrations/google";
import { ensureDefaultUser } from "@/infrastructure/db/supabase";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(`${appUrl()}/settings?google=denied`);
  try {
    await ensureDefaultUser();
    const tokens = await exchangeCode(code);
    await saveGoogleTokens(tokens);
    return NextResponse.redirect(`${appUrl()}/dashboard?google=connected`);
  } catch (err) {
    console.error("[google] oauth callback failed:", err);
    return NextResponse.redirect(`${appUrl()}/settings?google=error`);
  }
}
