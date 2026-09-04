import { NextResponse } from "next/server";
import { getBoard, saveBoard } from "@/core/board/store";
import type { BoardDoc } from "@/core/board/types";

/** One board: read it, and save it back. */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const doc = await getBoard(id);
  if (!doc) return NextResponse.json({ ok: false, error: "No such board." }, { status: 404 });
  return NextResponse.json({ ok: true, data: doc });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as BoardDoc | null;
  if (!body || body.id !== id) {
    return NextResponse.json({ ok: false, error: "Board body missing or mismatched." }, { status: 400 });
  }

  const res = await saveBoard(body);
  if (res.ok) return NextResponse.json({ ok: true, data: res.doc });

  if (res.reason === "conflict") {
    // 409 with the winning document attached, so the canvas can say "this
    // board changed elsewhere" and show what is actually stored rather than
    // leaving him typing into a copy that will never be saved.
    return NextResponse.json(
      { ok: false, error: "This board was changed on another device.", data: res.current },
      { status: 409 },
    );
  }
  if (res.reason === "too-large") {
    const mb = (res.bytes / 1024 / 1024).toFixed(1);
    return NextResponse.json(
      { ok: false, error: `Board is ${mb}MB, over the 2MB save limit. Delete some ink or files.` },
      { status: 413 },
    );
  }
  if (res.reason === "missing") {
    return NextResponse.json({ ok: false, error: "No such board." }, { status: 404 });
  }
  return NextResponse.json({ ok: false, error: "Save failed." }, { status: 500 });
}
