import { NextResponse } from "next/server";
import { listBoards, createBoard, deleteBoard } from "@/core/board/store";
import { emptyBoard } from "@/core/board/types";

/** The board index: list, create, delete. One board's contents live at [id]. */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, data: await listBoards() });
}

export async function POST(req: Request) {
  const { title } = (await req.json().catch(() => ({}))) as { title?: string };
  const doc = await createBoard(emptyBoard(title ?? ""));
  if (!doc) return NextResponse.json({ ok: false, error: "Could not create the board." }, { status: 500 });
  return NextResponse.json({ ok: true, data: doc });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "Missing id." }, { status: 400 });
  return NextResponse.json({ ok: await deleteBoard(id) });
}
