import { NextResponse } from "next/server";
import { getStocks } from "@/infrastructure/markets";

export const revalidate = 21600; // 6h — Alpha Vantage free tier is 25 req/day

export async function GET() {
  const data = await getStocks();
  return NextResponse.json({ ok: true, data }, { headers: { "cache-control": "public, max-age=21600" } });
}
