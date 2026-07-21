import { NextResponse } from "next/server";
import { proxyFetch } from "@/infrastructure/http/fetch";

export interface FxRate {
  pair: string;
  rate: number;
}

// Frankfurter (ECB data): free, no key. Rates update once a day — cache 6h.
let cache: { at: number; rates: FxRate[] } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.at < 6 * 3600 * 1000) {
    return NextResponse.json({ ok: true, data: cache.rates });
  }
  try {
    const res = await proxyFetch("https://api.frankfurter.dev/v1/latest?base=INR&symbols=USD,EUR,GBP,JPY", {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const j = (await res.json()) as { rates: Record<string, number> };
    // Frankfurter gives foreign-per-INR; invert to INR-per-foreign.
    const rates: FxRate[] = Object.entries(j.rates).map(([sym, v]) => ({
      pair: `${sym}/INR`,
      rate: sym === "JPY" ? 100 / v : 1 / v, // JPY quoted per 100
    }));
    cache = { at: Date.now(), rates };
    return NextResponse.json({ ok: true, data: rates });
  } catch {
    return NextResponse.json({ ok: true, data: cache?.rates ?? [] });
  }
}
