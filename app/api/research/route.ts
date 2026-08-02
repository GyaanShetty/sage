import { NextResponse } from "next/server";
import { research, listBriefs } from "@/core/research/deep";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, data: await listBriefs(20) });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { topic?: string } | null;
  if (!body?.topic) return NextResponse.json({ ok: false, error: "topic required" }, { status: 400 });

  const out = await research(body.topic);
  if ("error" in out) return NextResponse.json({ ok: false, error: out.error }, { status: 502 });
  return NextResponse.json({ ok: true, data: out });
}
