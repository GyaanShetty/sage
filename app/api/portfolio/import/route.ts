import { NextResponse } from "next/server";
import { bulkImport, type Holding } from "@/core/portfolio/store";

export const dynamic = "force-dynamic";

/**
 * Bulk holdings import. Accepts either parsed rows ({ rows: [...] }) or raw CSV
 * text ({ csv: "..." }). CSV columns (header, order-agnostic): symbol, kind,
 * qty, avgCost[, thesis]. Common aliases (quantity, avg, cost, price) accepted.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { rows?: Partial<Holding>[]; csv?: string };

  let rows: Partial<Holding>[] = [];
  if (Array.isArray(body.rows)) {
    rows = body.rows;
  } else if (typeof body.csv === "string") {
    rows = parseCsv(body.csv);
  }

  if (!rows.length) {
    return NextResponse.json({ ok: false, error: "No valid rows found" }, { status: 400 });
  }

  const result = await bulkImport(rows);
  return NextResponse.json({ ok: true, data: result });
}

function parseCsv(text: string): Partial<Holding>[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 1) return [];

  const split = (l: string) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  const header = split(lines[0]).map((h) => h.toLowerCase());
  const idx = (names: string[]) => header.findIndex((h) => names.includes(h));

  const iSym = idx(["symbol", "ticker", "asset"]);
  const iKind = idx(["kind", "type", "class"]);
  const iQty = idx(["qty", "quantity", "units", "shares", "amount"]);
  const iCost = idx(["avgcost", "avg cost", "avg", "cost", "price", "buy price", "avg price"]);
  const iThesis = idx(["thesis", "note", "notes"]);

  // If there's no recognizable header, treat every line as data: symbol,qty,cost
  const hasHeader = iSym >= 0 || iQty >= 0;
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const out: Partial<Holding>[] = [];
  for (const line of dataLines) {
    const c = split(line);
    const symbol = (iSym >= 0 ? c[iSym] : c[0]) ?? "";
    if (!symbol) continue;
    const rawKind = (iKind >= 0 ? c[iKind] : "").toLowerCase();
    const kind: Holding["kind"] = rawKind.startsWith("stock") || rawKind.startsWith("equit") ? "stock" : rawKind.startsWith("crypto") ? "crypto" : /^[A-Za-z0-9]{1,6}$/.test(symbol) && !symbol.includes("-") ? "stock" : "crypto";
    const qty = Number((iQty >= 0 ? c[iQty] : c[1]) ?? "0".replace(/[^0-9.\-]/g, ""));
    const avgCost = Number(((iCost >= 0 ? c[iCost] : c[2]) ?? "0").replace(/[^0-9.\-]/g, ""));
    if (!qty) continue;
    out.push({ symbol, kind, qty, avgCost, thesis: iThesis >= 0 ? c[iThesis] || null : null });
  }
  return out;
}
