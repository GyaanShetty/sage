import { NextResponse } from "next/server";
import { airingFor } from "@/infrastructure/integrations/youtube";

/**
 * What is actually playable on each channel right now.
 *
 * The television panel used to embed `/embed/live_stream?channel=…` and hope.
 * When a channel is not broadcasting that renders YouTube's error page inside
 * the tile, which is how two of the three screens came to be grey boxes.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("ids") ?? "";
  const ids = raw.split(",").map((s) => s.trim()).filter((s) => /^UC[\w-]{20,}$/.test(s)).slice(0, 6);
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });
  return NextResponse.json({ ok: true, data: await airingFor(ids) });
}
