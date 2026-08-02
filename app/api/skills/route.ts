import { NextResponse } from "next/server";
import { listSkills, upsertSkill, deleteSkill, summarise, skillHistory } from "@/core/education/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** All skills plus the derived summary. ?history=<id> for one skill's trail. */
export async function GET(req: Request) {
  const historyFor = new URL(req.url).searchParams.get("history");
  if (historyFor) {
    return NextResponse.json({ ok: true, data: await skillHistory(historyFor) });
  }
  const skills = await listSkills();
  return NextResponse.json({ ok: true, data: skills, summary: summarise(skills) });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ ok: false, error: "Invalid" }, { status: 400 });
  const skill = await upsertSkill(body);
  if (!skill) return NextResponse.json({ ok: false, error: "Name required" }, { status: 400 });
  return NextResponse.json({ ok: true, data: skill });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  return NextResponse.json({ ok: await deleteSkill(id) });
}
