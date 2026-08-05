import { NextResponse } from "next/server";
import { runBackup, exportAll, lastBackup, restoreBackup, type BackupFile } from "@/core/ops/backup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET             — when the last backup ran, and how old it is.
 * GET ?download=1 — the whole database as a file, right now, no configuration
 *                   required. The escape hatch that works before GitHub is set
 *                   up and if it ever stops working.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);

  if (url.searchParams.get("download")) {
    const file = await exportAll();
    const day = file.takenAt.slice(0, 10);
    return new Response(JSON.stringify(file), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="sage-backup-${day}.json"`,
        "cache-control": "no-store",
      },
    });
  }

  return NextResponse.json({ ok: true, data: { last: await lastBackup() } });
}

/** Run a backup now, or restore one that was uploaded. */
export async function POST(req: Request) {
  const type = req.headers.get("content-type") ?? "";

  // A restore arrives as the backup file itself.
  if (type.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    const upload = form?.get("file");
    if (!(upload instanceof File)) {
      return NextResponse.json({ ok: false, error: "No file uploaded." }, { status: 400 });
    }
    let parsed: BackupFile;
    try {
      parsed = JSON.parse(await upload.text()) as BackupFile;
    } catch {
      return NextResponse.json({ ok: false, error: "That file isn't valid JSON." }, { status: 400 });
    }
    const result = await restoreBackup(parsed);
    return NextResponse.json({ ok: result.ok, data: result, ...(result.ok ? {} : { error: result.errors.join("; ") }) });
  }

  const result = await runBackup();
  return NextResponse.json({ ok: result.ok, data: result, ...(result.ok ? {} : { error: result.error }) });
}
