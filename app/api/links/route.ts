import { NextResponse } from "next/server";
import { addLink, removeLink, linksFor, LINK_KINDS, type LinkKind, type LinkEnd } from "@/core/links/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isKind = (v: unknown): v is LinkKind => LINK_KINDS.includes(v as LinkKind);

function parseEnd(v: unknown): LinkEnd | null {
  if (!v || typeof v !== "object") return null;
  const e = v as Record<string, unknown>;
  if (!isKind(e.kind) || typeof e.id !== "string" || !e.id) return null;
  return {
    kind: e.kind,
    id: e.id.slice(0, 400),
    label: String(e.label ?? e.id).slice(0, 160),
  };
}

/** Everything linked to one thing: /api/links?kind=task&id=… */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const id = url.searchParams.get("id");
  if (!isKind(kind) || !id) {
    return NextResponse.json({ ok: false, error: "kind and id required" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, data: await linksFor(kind, id) });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const from = parseEnd((body as { from?: unknown })?.from);
  const to = parseEnd((body as { to?: unknown })?.to);
  if (!from || !to) return NextResponse.json({ ok: false, error: "from and to required" }, { status: 400 });

  const link = await addLink(from, to, (body as { note?: string })?.note?.slice(0, 300));
  if (!link) return NextResponse.json({ ok: false, error: "Could not link those" }, { status: 400 });
  return NextResponse.json({ ok: true, data: link });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  return NextResponse.json({ ok: await removeLink(id) });
}
