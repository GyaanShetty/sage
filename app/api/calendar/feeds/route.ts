import { NextResponse } from "next/server";
import { listFeeds, addFeed, updateFeed, removeFeed, feedEvents } from "@/core/calendar/feeds";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Subscribed calendars, and optionally what they currently contain. */
export async function GET(req: Request) {
  const withEvents = new URL(req.url).searchParams.get("events");
  const feeds = await listFeeds();
  const events = withEvents ? await feedEvents(14).catch(() => []) : undefined;
  return NextResponse.json({ ok: true, data: { feeds, ...(events ? { events } : {}) } });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { url?: string; label?: string; id?: string; enabled?: boolean };

  if (body.id) {
    await updateFeed(body.id, { enabled: body.enabled !== false, ...(body.label ? { label: body.label } : {}) });
    return NextResponse.json({ ok: true, data: { feeds: await listFeeds() } });
  }

  if (!body.url) return NextResponse.json({ ok: false, error: "url required" }, { status: 400 });
  const result = await addFeed(body.url, body.label);
  if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, data: { ...result, feeds: await listFeeds() } });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  await removeFeed(id);
  return NextResponse.json({ ok: true });
}
