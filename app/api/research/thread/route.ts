import { NextResponse } from "next/server";
import {
  listThreads, getThread, createThread, renameThread, deleteThread,
  listMessages, detach, signDownload,
} from "@/core/research/workspace";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");

  if (!id) return NextResponse.json({ ok: true, data: { threads: await listThreads() } });

  const thread = await getThread(id);
  if (!thread) return NextResponse.json({ ok: false, error: "No such thread." }, { status: 404 });

  // Previews need a URL the browser can fetch; the stored path is not one, and
  // signing them here keeps the links short-lived rather than permanent.
  const messages = await listMessages(id);
  const withUrls = await Promise.all(
    thread.attachments.map(async (a) => ({
      ...a,
      // The extracted text can be enormous and the client never renders it.
      text: undefined,
      hasText: !!a.text?.trim(),
      url: a.mime.startsWith("image/") ? await signDownload(a.path, 3600) : null,
    })),
  );

  return NextResponse.json({ ok: true, data: { thread: { ...thread, attachments: withUrls }, messages } });
}

export async function POST(req: Request) {
  const { title, id, rename } = (await req.json().catch(() => ({}))) as
    { title?: string; id?: string; rename?: string };

  if (id && rename !== undefined) {
    await renameThread(id, rename);
    return NextResponse.json({ ok: true });
  }

  const thread = await createThread(title?.trim() || "Untitled");
  return NextResponse.json({ ok: true, data: { thread } });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const attachment = url.searchParams.get("attachment");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  if (attachment) await detach(id, attachment);
  else await deleteThread(id);

  return NextResponse.json({ ok: true });
}
