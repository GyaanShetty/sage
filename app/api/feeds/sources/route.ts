import { NextResponse } from "next/server";
import { listFeedSources, addFeedSource, removeFeedSource } from "@/core/feeds/watchlist";

/** The YouTube watchlist: list, add by URL, remove by id. */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, data: await listFeedSources() });
}

export async function POST(req: Request) {
  const { url } = (await req.json().catch(() => ({}))) as { url?: string };
  if (!url) return NextResponse.json({ ok: false, error: "Paste a YouTube URL." }, { status: 400 });

  const row = await addFeedSource(url);
  // Naming the failure matters: "that is not a YouTube link SAGE can read" is
  // actionable, and a generic 400 sends him hunting for a bug that is a typo.
  if (!row) {
    return NextResponse.json(
      { ok: false, error: "Not a YouTube channel, @handle or video link." },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, data: row });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "Missing id." }, { status: 400 });
  return NextResponse.json({ ok: await removeFeedSource(id) });
}
