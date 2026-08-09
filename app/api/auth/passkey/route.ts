import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { listPasskeys, deletePasskey } from "@/core/auth/passkeys";
import { SESSION_COOKIE, verifyToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Managing keys needs a session — see the note in ./register/route.ts. */
async function authorised(): Promise<boolean> {
  const password = process.env.SAGE_PASSWORD;
  if (!password) return true;
  const jar = await cookies();
  return verifyToken(jar.get(SESSION_COOKIE)?.value, password);
}

export async function GET() {
  if (!(await authorised())) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  // Never the public key or the id — the list is for recognising a device, and
  // a management screen has no use for the credential material.
  const keys = (await listPasskeys()).map((k) => ({
    label: k.label, at: k.at, lastUsedAt: k.lastUsedAt ?? null,
    ref: k.id.slice(0, 8),
  }));
  return NextResponse.json({ ok: true, data: { keys } });
}

export async function DELETE(req: Request) {
  if (!(await authorised())) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const ref = new URL(req.url).searchParams.get("ref");
  if (!ref) return NextResponse.json({ ok: false, error: "ref required" }, { status: 400 });

  const match = (await listPasskeys()).find((k) => k.id.startsWith(ref));
  if (!match) return NextResponse.json({ ok: false, error: "No such key." }, { status: 404 });
  await deletePasskey(match.id);
  return NextResponse.json({ ok: true });
}
