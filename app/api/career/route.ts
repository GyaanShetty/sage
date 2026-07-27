import { NextResponse } from "next/server";
import { listApplications, upsertApplication, deleteApplication, scanInbox, type Application } from "@/core/career/scan";

export const dynamic = "force-dynamic";

export async function GET() {
  const apps = await listApplications();
  return NextResponse.json({ ok: true, data: apps });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string } & Partial<Application>;
  if (body.action === "scan") {
    const res = await scanInbox().catch(() => ({ added: 0, updated: 0 }));
    return NextResponse.json({ ok: true, data: res });
  }
  const id = await upsertApplication(body);
  return NextResponse.json({ ok: true, data: { id } });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  await deleteApplication(id);
  return NextResponse.json({ ok: true });
}
