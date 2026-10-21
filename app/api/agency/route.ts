import { NextResponse } from "next/server";
import { listProposals, getProposal, getSettings, setAuto, patchProposal } from "@/core/agency/store";
import { execute, undo } from "@/core/agency/act";
import { runProducers } from "@/core/agency/producers";
import { KIND_LABEL, SAFETY, mayAutoRun, type ProposalKind } from "@/core/agency/types";

/**
 * The docket: what SAGE wants to do, and what it has done.
 *
 * GET returns both halves, because the pane shows both and two round trips
 * for one panel on a free tier is one too many.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const [all, settings] = await Promise.all([listProposals({ limit: 120 }), getSettings()]);
  return NextResponse.json({
    ok: true,
    data: {
      open: all.filter((p) => p.status === "proposed"),
      recent: all.filter((p) => p.status !== "proposed").slice(0, 12),
      settings,
      // The UI should not have to know what a kind means or whether it is
      // safe — that is the model's business, published here.
      kinds: Object.fromEntries(
        (Object.keys(KIND_LABEL) as ProposalKind[]).map((k) => [
          k,
          { label: KIND_LABEL[k], ...SAFETY[k], autoEligible: !SAFETY[k].outward && SAFETY[k].reversible },
        ]),
      ),
    },
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: string; id?: string; kind?: ProposalKind; on?: boolean;
  };

  if (body.action === "scan") {
    const reports = await runProducers();
    return NextResponse.json({ ok: true, data: { reports } });
  }

  if (body.action === "auto" && body.kind) {
    /*
     * Refused here as well as in `mayAutoRun`, rather than trusting the UI
     * not to offer it. The outward rule is the one guarantee this whole
     * design rests on, and a guarantee enforced only in the component that
     * draws the checkbox is not a guarantee.
     */
    if (SAFETY[body.kind]?.outward) {
      return NextResponse.json(
        { ok: false, error: "Anything that leaves this machine is always approved by hand." },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, data: await setAuto(body.kind, body.on === true) });
  }

  if (!body.id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const p = await getProposal(body.id);
  if (!p) return NextResponse.json({ ok: false, error: "No such proposal." }, { status: 404 });

  if (body.action === "approve") {
    const out = await execute(p, false);
    return NextResponse.json({ ok: out.ok, data: out, error: out.error });
  }
  if (body.action === "dismiss") {
    await patchProposal(p.id, { status: "dismissed", decidedAt: new Date().toISOString() });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "undo") {
    const out = await undo(p);
    return NextResponse.json({ ok: out.ok, data: out, error: out.error });
  }
  return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
}

/** Run the producers, then anything standing permission covers. */
export async function PUT() {
  const reports = await runProducers();
  const settings = await getSettings();
  const open = await listProposals({ status: ["proposed"] });
  const ran: string[] = [];
  for (const p of open) {
    if (!mayAutoRun(p.kind, settings)) continue;
    const out = await execute(p, true);
    ran.push(`${p.kind}:${out.ok ? "ok" : "failed"}`);
  }
  return NextResponse.json({ ok: true, data: { reports, ran } });
}
