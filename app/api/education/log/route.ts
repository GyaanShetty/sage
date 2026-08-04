import { NextResponse } from "next/server";
import { addEntry, listEntries, deleteEntry, resolveEntry, studyStats, ENTRY_KINDS, type EntryKind } from "@/core/education/log";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const skillId = new URL(req.url).searchParams.get("skillId") ?? undefined;
  const entries = await listEntries(skillId);
  return NextResponse.json({ ok: true, data: { entries, stats: studyStats(entries) } });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: "resolve";
    id?: string;
    skillId?: string; kind?: EntryKind; text?: string; url?: string; minutes?: number; tags?: string[];
  };

  if (body.action === "resolve") {
    if (!body.id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
    return NextResponse.json({ ok: await resolveEntry(body.id) });
  }

  if (!body.skillId || !body.text?.trim()) {
    return NextResponse.json({ ok: false, error: "skillId and text required" }, { status: 400 });
  }

  const entry = await addEntry({
    skillId: body.skillId,
    kind: ENTRY_KINDS.includes(body.kind as EntryKind) ? (body.kind as EntryKind) : "note",
    text: body.text,
    ...(body.url ? { url: body.url } : {}),
    ...(body.minutes ? { minutes: body.minutes } : {}),
    ...(body.tags ? { tags: body.tags } : {}),
  });
  if (!entry) return NextResponse.json({ ok: false, error: "Couldn't save that." }, { status: 400 });
  return NextResponse.json({ ok: true, data: entry });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  return NextResponse.json({ ok: await deleteEntry(id) });
}
