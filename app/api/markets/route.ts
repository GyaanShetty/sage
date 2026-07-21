import { NextResponse } from "next/server";
import { getMarkets } from "@/infrastructure/markets";

export const revalidate = 120; // cache 2 min

export async function GET() {
  const data = await getMarkets();
  return NextResponse.json({ ok: true, data }, { headers: { "cache-control": "public, max-age=120" } });
}
