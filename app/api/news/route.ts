import { NextResponse } from "next/server";
import { getNews } from "@/infrastructure/news";

export const revalidate = 600; // cache 10 min

export async function GET() {
  const data = await getNews();
  return NextResponse.json({ ok: true, data }, { headers: { "cache-control": "public, max-age=600" } });
}
