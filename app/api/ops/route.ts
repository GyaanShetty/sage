import { NextResponse } from "next/server";
import { recordError, listErrors, resolveError } from "@/core/ops/errors";
import { listTriage, triageOutstanding } from "@/core/ops/triage";
import { pruneEvents, storageBreakdown } from "@/core/ops/retention";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Repository paths, for triage to point at. Cheap and cached per invocation. */
async function repoFiles(): Promise<string[]> {
  try {
    const { readdir } = await import("node:fs/promises");
    const roots = ["app", "core", "features", "infrastructure", "lib", "components"];
    const out: string[] = [];
    const walk = async (dir: string, depth = 0) => {
      if (depth > 4 || out.length > 600) return;
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) await walk(p, depth + 1);
        else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
      }
    };
    for (const r of roots) await walk(r);
    return out;
  } catch {
    // On a serverless filesystem this may not be readable; triage still works
    // without paths, it just cannot name a file.
    return [];
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  // ?storage=1 — what is actually filling the database.
  if (url.searchParams.get("storage") === "1") {
    const [breakdown, preview] = await Promise.all([storageBreakdown(), pruneEvents(true)]);
    return NextResponse.json({
      ok: true,
      data: {
        breakdown,
        totalRows: breakdown.reduce((a, b) => a + b.rows, 0),
        prunable: preview.total,
      },
    });
  }

  const includeResolved = url.searchParams.get("all") === "1";
  const [errors, triage] = await Promise.all([listErrors(includeResolved), listTriage()]);
  const byFingerprint = new Map(triage.map((t) => [t.fingerprint, t]));
  return NextResponse.json({
    ok: true,
    data: errors.map((e) => ({ ...e, triage: byFingerprint.get(e.fingerprint) ?? null })),
  });
}

/** Report an error, or run triage. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;

  if (body?.action === "prune") {
    return NextResponse.json({ ok: true, data: await pruneEvents(false) });
  }

  if (body?.action === "triage") {
    const files = await repoFiles();
    return NextResponse.json({ ok: true, data: await triageOutstanding(files, 3) });
  }

  if (typeof body?.message !== "string") {
    return NextResponse.json({ ok: false, error: "message required" }, { status: 400 });
  }
  const report = await recordError({
    message: body.message,
    stack: typeof body.stack === "string" ? body.stack : undefined,
    where: typeof body.where === "string" ? body.where : "unknown",
    side: typeof body.side === "string" ? body.side : "client",
    context: (body.context ?? undefined) as Record<string, string> | undefined,
  });
  return NextResponse.json({ ok: !!report });
}

export async function DELETE(req: Request) {
  const fp = new URL(req.url).searchParams.get("fingerprint");
  if (!fp) return NextResponse.json({ ok: false, error: "fingerprint required" }, { status: 400 });
  return NextResponse.json({ ok: await resolveError(fp) });
}
