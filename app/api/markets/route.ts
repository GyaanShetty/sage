import { NextResponse } from "next/server";
import { getMarkets } from "@/infrastructure/markets";

export const revalidate = 120; // cache 2 min

export async function GET(req: Request) {
  const ids = new URL(req.url).searchParams.get("ids");
  const data = await getMarkets(ids ? ids.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 12) : undefined);
  return NextResponse.json({ ok: true, data }, { headers: { "cache-control": "public, max-age=120" } });
}
