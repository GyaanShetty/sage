import { NextResponse } from "next/server";
import { exchangeTickTickCode } from "@/infrastructure/integrations/ticktick";
import { appUrl } from "@/infrastructure/integrations/google";
import { ensureDefaultUser } from "@/infrastructure/db/supabase";

export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code");
  if (!code) return NextResponse.redirect(`${appUrl()}/settings?ticktick=denied`);
  try {
    await ensureDefaultUser();
    const ok = await exchangeTickTickCode(code);
    return NextResponse.redirect(`${appUrl()}/dashboard?ticktick=${ok ? "connected" : "error"}`);
  } catch (err) {
    console.error("[ticktick] callback failed:", err);
    return NextResponse.redirect(`${appUrl()}/settings?ticktick=error`);
  }
}
