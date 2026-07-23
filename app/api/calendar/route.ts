import { NextResponse } from "next/server";
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from "@/infrastructure/integrations/google";

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
