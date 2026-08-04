import { NextResponse } from "next/server";
import { coach, saveAttempt, listAttempts, HELP_LEVELS, type HelpLevel } from "@/core/coding/coach";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("slug") ?? undefined;
  return NextResponse.json({ ok: true, data: await listAttempts(slug) });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: "coach" | "save";
    level?: HelpLevel;
    slug?: string; title?: string; statement?: string;
    language?: string; code?: string; runOutput?: string;
    ran?: boolean; helpUsed?: HelpLevel[];
  };

  if (body.action === "save") {
    if (!body.slug || !body.code) return NextResponse.json({ ok: false, error: "slug and code required" }, { status: 400 });
    const id = await saveAttempt({
      slug: body.slug,
      title: body.title ?? body.slug,
      language: body.language ?? "python3",
      code: body.code,
      ran: !!body.ran,
      helpUsed: (body.helpUsed ?? []).filter((h) => HELP_LEVELS.includes(h)),
    });
    return NextResponse.json({ ok: true, data: { id } });
  }

  if (!body.title || !body.statement) {
    return NextResponse.json({ ok: false, error: "title and statement required" }, { status: 400 });
  }

  const out = await coach({
    level: body.level ?? "nudge",
    title: body.title,
    statement: body.statement,
    language: body.language ?? "python3",
    code: body.code ?? "",
    ...(body.runOutput ? { runOutput: body.runOutput } : {}),
  });

  if ("error" in out) return NextResponse.json({ ok: false, error: out.error }, { status: 502 });
  return NextResponse.json({ ok: true, data: out });
}
