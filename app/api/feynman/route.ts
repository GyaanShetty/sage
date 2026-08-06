import { NextResponse } from "next/server";
import {
  listConcepts, addConcept, retireConcept, deleteConcept, gradeExplanation, dueOf,
} from "@/core/feynman";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const concepts = await listConcepts();
  return NextResponse.json({ ok: true, data: { concepts, due: dueOf(concepts) } });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    explanation?: string;
    title?: string;
    source?: string;
    sourceUrl?: string;
    skillId?: string;
    retired?: boolean;
  };

  // An explanation names the concept it is answering.
  if (body.id && typeof body.explanation === "string") {
    const result = await gradeExplanation(body.id, body.explanation);
    if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true, data: result });
  }

  if (body.id && typeof body.retired === "boolean") {
    await retireConcept(body.id, body.retired);
    return NextResponse.json({ ok: true });
  }

  if (!body.title?.trim() || !body.source?.trim()) {
    return NextResponse.json(
      { ok: false, error: "A concept needs a title and the source it will be graded against." },
      { status: 400 },
    );
  }

  const id = await addConcept({
    title: body.title, source: body.source, sourceUrl: body.sourceUrl, skillId: body.skillId,
  });
  return NextResponse.json({ ok: !!id, data: { id } }, { status: id ? 200 : 400 });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  await deleteConcept(id);
  return NextResponse.json({ ok: true });
}
