import { NextResponse } from "next/server";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

export const maxDuration = 60;
const BUCKET = "sage-files";

async function ensureBucket() {
  // idempotent — ignores "already exists"
  await db.storage.createBucket(BUCKET, { public: false, fileSizeLimit: "25MB" }).catch(() => {});
}

interface Attachment { name: string; path: string; size: number; addedAt: string }

/** Upload a file (PDF/doc/etc.) and attach it to an application. */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const appId = form?.get("appId") as string | null;
  const file = form?.get("file") as File | null;
  if (!appId || !file) return NextResponse.json({ ok: false, error: "appId and file required" }, { status: 400 });

  await ensureBucket();
  const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(0, 80);
  const path = `career/${appId}/${Date.now()}-${safe}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error } = await db.storage.from(BUCKET).upload(path, bytes, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // append to the application's attachments list
  const { data } = await db.from("Event").select("payload").eq("id", appId).maybeSingle();
  const payload = (data?.payload ?? {}) as { attachments?: Attachment[] };
  const attachments = [...(payload.attachments ?? []), { name: file.name, path, size: file.size, addedAt: new Date().toISOString() }];
  await db.from("Event").update({ payload: { ...payload, attachments } }).eq("id", appId).eq("userId", DEFAULT_USER_ID);

  return NextResponse.json({ ok: true, data: { attachments } });
}

/** GET ?path=… → a short-lived signed URL to view/download the file. */
export async function GET(req: Request) {
  const path = new URL(req.url).searchParams.get("path");
  if (!path) return NextResponse.json({ ok: false, error: "path required" }, { status: 400 });
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, 600);
  if (error || !data) return NextResponse.json({ ok: false, error: error?.message ?? "not found" }, { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}

/** DELETE ?appId=…&path=… → remove an attachment. */
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const appId = url.searchParams.get("appId");
  const path = url.searchParams.get("path");
  if (!appId || !path) return NextResponse.json({ ok: false, error: "appId and path required" }, { status: 400 });
  await db.storage.from(BUCKET).remove([path]).catch(() => {});
  const { data } = await db.from("Event").select("payload").eq("id", appId).maybeSingle();
  const payload = (data?.payload ?? {}) as { attachments?: Attachment[] };
  const attachments = (payload.attachments ?? []).filter((a) => a.path !== path);
  await db.from("Event").update({ payload: { ...payload, attachments } }).eq("id", appId).eq("userId", DEFAULT_USER_ID);
  return NextResponse.json({ ok: true, data: { attachments } });
}
