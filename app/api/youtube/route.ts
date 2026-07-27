import { NextResponse } from "next/server";
import { getMorningVideos } from "@/infrastructure/integrations/youtube";

export const revalidate = 1800;

/** Latest videos from the morning watch channels. */
export async function GET() {
  const videos = await getMorningVideos(2);
  return NextResponse.json({ ok: true, data: { videos } });
}
