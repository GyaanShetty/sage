import { NextResponse } from "next/server";
import { getPositions } from "@/core/portfolio/store";
import { listSnapshots } from "@/core/portfolio/snapshots";
import { riskMetrics, rebalance, attribution, riskAdjusted } from "@/core/portfolio/analytics";

export const dynamic = "force-dynamic";

/** Risk profile + rebalancing plan for the current book. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const cookie = req.headers.get("cookie") ?? "";

  // optional targets: ?targets=BTC:40,ETH:30,NVDA:30
  const targets: Record<string, number> = {};
  for (const pair of (url.searchParams.get("targets") ?? "").split(",")) {
    const [sym, pct] = pair.split(":");
    if (sym && pct && Number.isFinite(Number(pct))) targets[sym.toUpperCase()] = Number(pct);
  }

  const [{ positions }, snaps] = await Promise.all([
    getPositions(url.origin, cookie),
    listSnapshots(180),
  ]);

  return NextResponse.json({
    ok: true,
    data: {
      risk: riskMetrics(positions, snaps),
      rebalance: rebalance(positions, targets),
      attribution: attribution(positions),
      riskAdjusted: riskAdjusted(snaps),
      historyPoints: snaps.length,
    },
  });
}
