import { NextResponse } from "next/server";
import { getMorningVideos } from "@/infrastructure/integrations/youtube";

export const revalidate = 1800;

/** Latest videos from the morning watch channels. */
export async function GET() {
  /*
   * Four per channel over two days, not two over one.
   *
   * The dashboard used to show three of these in a strip under the
   * screens. The players now size to the video they contain, which hands
   * back roughly 500px of stage, and that space is worth filling with
   * more of what the channels actually published than with black.
   */
  const videos = await getMorningVideos(4, 48);
  return NextResponse.json({ ok: true, data: { videos } });
}
