import { NextResponse } from "next/server";
import { argueAgainst, type AdvocateInput } from "@/core/decisions/advocate";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

/** The case against, before he commits. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<AdvocateInput>;
  if (!body.title?.trim() || !body.expectation?.trim()) {
    return NextResponse.json({ ok: false, error: "title and expectation required" }, { status: 400 });
  }

  const result = await argueAgainst({
    title: body.title,
    reasoning: body.reasoning ?? "",
    expectation: body.expectation,
    confidence: Number(body.confidence) || 70,
    domain: body.domain ?? "life",
    ...(body.alternatives ? { alternatives: body.alternatives } : {}),
  });

  if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  return NextResponse.json({ ok: true, data: result });
}
