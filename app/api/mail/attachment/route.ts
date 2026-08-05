import { NextResponse } from "next/server";
import { getGmailMessage, getGmailAttachment } from "@/infrastructure/integrations/google";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Serve one attachment from one message.
 *
 * The filename and content type are read back off the message rather than
 * taken from the query string. A caller-supplied name would be a way to have
 * SAGE serve arbitrary bytes under any extension the caller liked, and the
 * message is being fetched anyway to confirm the attachment belongs to it.
 *
 * `?download=1` forces a save dialog; without it images and PDFs render in
 * place, which is the point — an attachment you have to download to glance at
 * may as well not be in the app.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const messageId = url.searchParams.get("id");
  const attachmentId = url.searchParams.get("att");
  if (!messageId || !attachmentId) {
    return NextResponse.json({ ok: false, error: "id and att required" }, { status: 400 });
  }

  const msg = await getGmailMessage(messageId);
  if (!msg) return NextResponse.json({ ok: false, error: "Couldn't read that message." }, { status: 404 });

  const meta = msg.attachments.find((a) => a.attachmentId === attachmentId);
  if (!meta) return NextResponse.json({ ok: false, error: "No such attachment on that message." }, { status: 404 });

  const bytes = await getGmailAttachment(messageId, attachmentId);
  if (!bytes) return NextResponse.json({ ok: false, error: "Gmail wouldn't hand that file over." }, { status: 502 });

  // Quotes escaped, not stripped: a filename is the sender's text, and it
  // reaches a header here.
  const safeName = meta.filename.replace(/["\\\r\n]/g, "_");
  const inline = !url.searchParams.get("download") && (meta.isImage || meta.mimeType === "application/pdf");

  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "content-type": meta.mimeType || "application/octet-stream",
      "content-length": String(bytes.byteLength),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${safeName}"`,
      // Attachments never change, but they are private — cached on his device
      // only, never in anything shared.
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
    },
  });
}
