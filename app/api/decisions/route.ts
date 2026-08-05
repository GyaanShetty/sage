import { NextResponse } from "next/server";
import {
  listDecisions, addDecision, reviewDecision, deleteDecision, dueForReview,
  type DecisionInput, type Outcome,
} from "@/core/decisions/store";
import { calibrate } from "@/core/decisions/calibration";

export const dynamic = "force-dynamic";

export async function GET() {
  const decisions = await listDecisions();
  return NextResponse.json({
    ok: true,
    data: {
      decisions,
      due: dueForReview(decisions),
      calibration: calibrate(decisions),
    },
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as
    & Partial<DecisionInput>
    & { id?: string; outcome?: Outcome; whatHappened?: string; lesson?: string };

  // A review names the decision it is scoring.
  if (body.id) {
    if (!body.outcome || !body.whatHappened?.trim()) {
      return NextResponse.json({ ok: false, error: "outcome and whatHappened required" }, { status: 400 });
    }
    const ok = await reviewDecision(body.id, {
      outcome: body.outcome,
      whatHappened: body.whatHappened,
      ...(body.lesson ? { lesson: body.lesson } : {}),
    });
    if (!ok) return NextResponse.json({ ok: false, error: "No such decision." }, { status: 404 });
  } else {
    if (!body.title?.trim() || !body.expectation?.trim() || !body.reviewAt) {
      return NextResponse.json({ ok: false, error: "title, expectation and reviewAt required" }, { status: 400 });
    }
    await addDecision({
      title: body.title,
      reasoning: body.reasoning ?? "",
      expectation: body.expectation,
      confidence: Number(body.confidence) || 70,
      domain: body.domain ?? "life",
      reviewAt: body.reviewAt,
      ...(body.alternatives ? { alternatives: body.alternatives } : {}),
    });

    // A decision with no reminder is a decision he will not review, and an
    // unreviewed journal measures nothing. Same delivery path as everything
    // else, so the heartbeat fires it on the day.
    const { db, DEFAULT_USER_ID } = await import("@/infrastructure/db/supabase");
    await db.from("Reminder").insert({
      id: crypto.randomUUID(),
      userId: DEFAULT_USER_ID,
      text: `Review your call: ${body.title.trim().slice(0, 120)}`,
      remindAt: new Date(body.reviewAt).toISOString(),
    }).then(() => undefined, () => undefined);
  }

  const decisions = await listDecisions();
  return NextResponse.json({
    ok: true,
    data: { decisions, due: dueForReview(decisions), calibration: calibrate(decisions) },
  });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  await deleteDecision(id);
  return NextResponse.json({ ok: true });
}
