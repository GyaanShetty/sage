import { NextResponse } from "next/server";
import { ticktickAuthUrl } from "@/infrastructure/integrations/ticktick";

export async function GET() {
  if (!process.env.TICKTICK_CLIENT_ID) {
    return NextResponse.json({ ok: false, error: "TickTick not configured" }, { status: 400 });
  }
  return NextResponse.redirect(ticktickAuthUrl());
}
