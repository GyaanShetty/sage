import { NextResponse } from "next/server";
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from "@/infrastructure/integrations/google";
import { eventsBetween } from "@/core/calendar";
import { listFeeds } from "@/core/calendar/feeds";
import { getLeadMinutes } from "@/core/reminders/prep";

export const dynamic = "force-dynamic";

/**
 * Everything in a window: Google plus every subscribed feed.
 *
 * The range comes from the client because it is the client that knows which
 * month is on screen, and a month grid needs the days already gone as much as
 * the ones ahead.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to) return NextResponse.json({ ok: false, error: "from and to required" }, { status: 400 });

  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return NextResponse.json({ ok: false, error: "from and to must be dates" }, { status: 400 });
  }

  const [events, feeds, lead] = await Promise.all([
    eventsBetween(fromDate, toDate).catch(() => []),
    listFeeds().catch(() => []),
    getLeadMinutes().catch(() => 15),
  ]);

  return NextResponse.json({
    ok: true,
    data: {
      events,
      feeds: feeds.map((f) => ({ label: f.label, enabled: f.enabled, error: f.lastError ?? null })),
      lead,
    },
  });
}

export const maxDuration = 30;

/** Create a calendar event. Body: { summary, start, end, allDay?, location? } */
export async function POST(req: Request) {
  const b = (await req.json()) as { summary?: string; start?: string; end?: string; allDay?: boolean; location?: string };
  if (!b.summary || !b.start) return NextResponse.json({ ok: false, error: "summary and start required" }, { status: 400 });
  const end = b.end ?? new Date(new Date(b.start).getTime() + 3600_000).toISOString();
  const r = await createCalendarEvent({ summary: b.summary, start: b.start, end, allDay: b.allDay, location: b.location });
  if (r === null) return NextResponse.json({ ok: false, error: "Google not connected (reconnect for calendar edit access)" }, { status: 400 });
  return NextResponse.json({ ok: true, data: r });
}

/** Update an event. Body: { id, ...fields } */
export async function PATCH(req: Request) {
  const b = (await req.json()) as { id?: string; summary?: string; start?: string; end?: string; allDay?: boolean; location?: string };
  if (!b.id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const ok = await updateCalendarEvent(b.id, b);
  if (ok === null) return NextResponse.json({ ok: false, error: "Google not connected" }, { status: 400 });
  return NextResponse.json({ ok });
}

/** Delete an event. Body: { id } */
export async function DELETE(req: Request) {
  const b = (await req.json()) as { id?: string };
  if (!b.id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const ok = await deleteCalendarEvent(b.id);
  if (ok === null) return NextResponse.json({ ok: false, error: "Google not connected" }, { status: 400 });
  return NextResponse.json({ ok });
}
