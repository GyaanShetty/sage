import { NextResponse } from "next/server";
import { getAllSourceHeadlines, getSourceHeadlines, NEWS_SOURCES } from "@/infrastructure/news";

export const revalidate = 600;

/** Headlines for one Morning Block source: /api/feeds?source=ft */
export async function GET(req: Request) {
  const source = new URL(req.url).searchParams.get("source") ?? "";

  /* Everything at once — what the wire tab wants for the rest of the day,
     when the question is "what has happened" rather than "what has the FT
     said". Limited because this is six feeds of eight, deduplicated. */
  if (source === "all") {
    const items = (await getAllSourceHeadlines(8)).slice(0, 40);
    return NextResponse.json({ ok: true, data: { source: "All sources", items } });
  }

  if (!NEWS_SOURCES[source]) {
    return NextResponse.json({ ok: false, error: "unknown source" }, { status: 400 });
  }
  const items = await getSourceHeadlines(source, 6);
  return NextResponse.json({ ok: true, data: { source: NEWS_SOURCES[source].source, items } });
}
