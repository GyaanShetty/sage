import { NextResponse } from "next/server";
import { buildDossier } from "@/core/dossier";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Everything SAGE already knows about a person, company or topic. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ ok: false, error: "q required" }, { status: 400 });
  return NextResponse.json({ ok: true, data: await buildDossier(q) });
}
