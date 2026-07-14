import { NextResponse } from "next/server";
import { ingestPdf, ingestUrl } from "@/core/knowledge/ingest";

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".pdf")) {
        return NextResponse.json({ ok: false, error: "Upload a PDF file" }, { status: 400 });
      }
      if (file.size > 20 * 1024 * 1024) {
        return NextResponse.json({ ok: false, error: "PDF too large (max 20MB)" }, { status: 400 });
      }
      const result = await ingestPdf(Buffer.from(await file.arrayBuffer()), file.name);
      return NextResponse.json({ ok: true, data: result });
    }

    const { url } = await req.json();
    if (typeof url !== "string") {
      return NextResponse.json({ ok: false, error: "Provide a url" }, { status: 400 });
    }
    const result = await ingestUrl(url);
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ingestion failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
