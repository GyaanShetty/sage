import { NextResponse } from "next/server";
import { parseCapture, fileItems, KINDS, type CapturedItem } from "@/core/capture";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Vercel Hobby caps the body around 4.5MB; images have to fit under it. */
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_IMAGES = 4;

/**
 * Two verbs, one route.
 *
 * `parse` reads a ramble or a screenshot and proposes items. `file` writes the
 * ones he ticked. They are deliberately separate calls with a human in between
 * — see the note in core/capture on why nothing is written on the first pass.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: "parse" | "file";
    text?: string;
    source?: string;
    images?: string[];
    items?: CapturedItem[];
  };

  if (body.action === "file") {
    const items = (body.items ?? []).filter((i) => i && KINDS.includes(i.kind) && i.text?.trim());
    if (items.length === 0) return NextResponse.json({ ok: false, error: "Nothing ticked." }, { status: 400 });
    try {
      return NextResponse.json({ ok: true, data: { filed: await fileItems(items) } });
    } catch (err) {
      return NextResponse.json({ ok: false, error: (err as Error).message.slice(0, 200) }, { status: 500 });
    }
  }

  // ── parse ────────────────────────────────────────────────────────────────
  const images: Buffer[] = [];
  for (const raw of (body.images ?? []).slice(0, MAX_IMAGES)) {
    // Data URLs arrive from the browser's FileReader; strip the prefix.
    const b64 = raw.includes(",") ? raw.slice(raw.indexOf(",") + 1) : raw;
    const buf = Buffer.from(b64, "base64");
    if (buf.length === 0) continue;
    if (buf.length > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { ok: false, error: "That image is over 3MB — the upload limit on the free tier. Screenshot it smaller." },
        { status: 413 },
      );
    }
    images.push(buf);
  }

  const result = await parseCapture(body.text ?? "", body.source ?? (images.length ? "image" : "voice"), images);
  if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  return NextResponse.json({ ok: true, data: result });
}
