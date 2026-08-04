import { NextResponse } from "next/server";
import { runCode, LANGUAGES, type LangKey } from "@/infrastructure/exec/piston";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { lang?: string; source?: string; stdin?: string };
  const lang = body.lang as LangKey;

  if (!lang || !(lang in LANGUAGES)) {
    return NextResponse.json({ ok: false, error: `Pick one of: ${Object.keys(LANGUAGES).join(", ")}` }, { status: 400 });
  }
  if (!body.source?.trim()) {
    return NextResponse.json({ ok: false, error: "Nothing to run." }, { status: 400 });
  }
  // A generous cap rather than none: this is posted straight to a public
  // runner, and a megabyte of source is a mistake or an abuse, never a solve.
  if (body.source.length > 100_000) {
    return NextResponse.json({ ok: false, error: "That source is too large to run." }, { status: 413 });
  }

  const result = await runCode(lang, body.source, (body.stdin ?? "").slice(0, 20_000));
  return NextResponse.json({ ok: true, data: result });
}
