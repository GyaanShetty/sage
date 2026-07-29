import { NextResponse } from "next/server";
import { addAlert, deleteAlert, listAlerts, updateAlert, describeAlert, type PriceAlert } from "@/core/portfolio/alerts";

export const dynamic = "force-dynamic";

export async function GET() {
  const alerts = await listAlerts();
  return NextResponse.json({ ok: true, data: alerts.map((a) => ({ ...a, description: describeAlert(a) })) });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<PriceAlert> & { id?: string };
  if (body.id) {
    await updateAlert(body.id, body);
    return NextResponse.json({ ok: true, data: { id: body.id } });
  }
  if (!body.symbol) return NextResponse.json({ ok: false, error: "symbol required" }, { status: 400 });
  const id = await addAlert(body);
  return NextResponse.json({ ok: true, data: { id } });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  await deleteAlert(id);
  return NextResponse.json({ ok: true });
}
