import { NextResponse } from "next/server";
import { channelStills } from "@/infrastructure/integrations/youtube";

/**
 * Preview stills for the live television panel.
 *
 * Half an hour of caching: the picture is a channel's latest upload, which
 * changes a few times a day at most, and nineteen channel feeds is not
 * something to fetch on every dashboard load.
 */
export const revalidate = 1800;

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("ids") ?? "";
  const ids = raw.split(",").map((s) => s.trim()).filter((s) => /^UC[\w-]{20,}$/.test(s)).slice(0, 12);
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });
  return NextResponse.json({ ok: true, data: await channelStills(ids) });
}
