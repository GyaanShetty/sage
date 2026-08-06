import { NextResponse } from "next/server";
import { signUpload, attach } from "@/core/research/workspace";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Two steps, because the bytes must not come through here.
 *
 * A Vercel function body is capped around 4.5MB, so anything worth calling a
 * large file cannot be posted to an API route. POST here returns a signed URL
 * the browser uploads straight to storage with; PUT then registers what landed
 * and extracts its text. The ceiling becomes the storage quota rather than a
 * request limit.
 */
export async function POST(req: Request) {
  const { threadId, name } = (await req.json().catch(() => ({}))) as { threadId?: string; name?: string };
  if (!threadId || !name) return NextResponse.json({ ok: false, error: "threadId and name required" }, { status: 400 });

  const signed = await signUpload(threadId, name);
  if ("error" in signed) return NextResponse.json({ ok: false, error: signed.error }, { status: 500 });
  return NextResponse.json({ ok: true, data: signed });
}

/** Register a file that has finished uploading. */
export async function PUT(req: Request) {
  const body = (await req.json().catch(() => ({}))) as
    { threadId?: string; name?: string; path?: string; mime?: string; size?: number };

  if (!body.threadId || !body.name || !body.path) {
    return NextResponse.json({ ok: false, error: "threadId, name and path required" }, { status: 400 });
  }

  const result = await attach(body.threadId, {
    name: body.name,
    path: body.path,
    mime: body.mime ?? "application/octet-stream",
    size: Number(body.size) || 0,
  });

  if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, data: { attachment: { ...result, text: undefined, hasText: !!result.text?.trim() } } });
}
