import { NextResponse } from "next/server";
import { getSourceHeadlines, NEWS_SOURCES } from "@/infrastructure/news";

export const revalidate = 600;

/** Headlines for one Morning Block source: /api/feeds?source=ft */
export async function GET(req: Request) {
  const source = new URL(req.url).searchParams.get("source") ?? "";
  if (!NEWS_SOURCES[source]) {
    return NextResponse.json({ ok: false, error: "unknown source" }, { status: 400 });
  }
  const items = await getSourceHeadlines(source, 6);
  return NextResponse.json({ ok: true, data: { source: NEWS_SOURCES[source].source, items } });
}
