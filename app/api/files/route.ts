import { NextResponse } from "next/server";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const BUCKET = "sage-files";
const TYPE = "file.uploaded";
const MAX_BYTES = 20 * 1024 * 1024;

export interface StoredFile {
  id: string;
  name: string;
  path: string;
  size: number;
  mime: string;
  uploadedAt: string;
  /** Extracted text, truncated. Present only for formats we can read. */
  text?: string;
  chars?: number;
}

async function ensureBucket() {
  await db.storage.createBucket(BUCKET, { public: false, fileSizeLimit: "25MB" }).catch(() => {});
}

/**
 * Pull readable text out of a file.
 *
 * Deliberately narrow. A format we cannot read returns nothing rather than
 * bytes-as-text: handing a model the raw contents of a .docx produces
 * confident nonsense about XML, which is worse than admitting the file is
 * opaque.
 */
async function extractText(file: File, bytes: Uint8Array): Promise<string | null> {
  const name = file.name.toLowerCase();
  const mime = file.type || "";

  if (name.endsWith(".pdf") || mime === "application/pdf") {
    try {
      // Order matters: pdfjs grabs DOMMatrix at module-evaluation time.
      const { installPdfGlobals } = await import("@/infrastructure/pdf/node-globals");
      installPdfGlobals();
      const { PDFParse } = await import("pdf-parse");
      const parsed = await new PDFParse({ data: bytes }).getText();
      return parsed.text?.trim() || null;
    } catch {
      return null;
    }
  }

  const textual = /\.(txt|md|markdown|csv|tsv|json|ya?ml|log|ts|tsx|js|jsx|py|sql|html?|css)$/.test(name)
    || mime.startsWith("text/")
    || mime === "application/json";
  if (textual) {
    try {
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes).trim() || null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Upload a file and, where possible, read it. */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file") as File | null;
  if (!file) return NextResponse.json({ ok: false, error: "file required" }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "File is over 20 MB." }, { status: 413 });
  }

  await ensureBucket();
  const id = crypto.randomUUID();
  const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(0, 80) || "file";
  const path = `uploads/${id}-${safe}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error } = await db.storage.from(BUCKET).upload(path, bytes, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const text = await extractText(file, bytes);
  const record: StoredFile = {
    id, name: file.name, path, size: file.size,
    mime: file.type || "application/octet-stream",
    uploadedAt: new Date().toISOString(),
    // Stored truncated: the row is read into prompts, and a 400-page PDF would
    // blow the context window on its own.
    ...(text ? { text: text.slice(0, 40_000), chars: text.length } : {}),
  };
  await db.from("Event").insert({ id, userId: DEFAULT_USER_ID, type: TYPE, payload: record });

  return NextResponse.json({
    ok: true,
    data: { ...record, text: undefined, readable: !!text, chars: record.chars ?? 0 },
  });
}

/** GET → list recent uploads. GET ?path=… → a short-lived signed URL. */
export async function GET(req: Request) {
  const path = new URL(req.url).searchParams.get("path");
  if (path) {
    const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, 300);
    if (error || !data) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    return NextResponse.redirect(data.signedUrl);
  }

  const { data } = await db
    .from("Event")
    .select("payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE)
    .order("createdAt", { ascending: false })
    .limit(30);

  return NextResponse.json({
    ok: true,
    data: (data ?? []).map((r) => {
      const f = r.payload as StoredFile;
      // Never ship the extracted body in a list — it is large and nobody
      // rendering a list of filenames needs it.
      return { ...f, text: undefined, readable: !!f.text, chars: f.chars ?? 0 };
    }),
  });
}
