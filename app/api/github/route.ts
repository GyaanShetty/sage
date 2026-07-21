import { NextResponse } from "next/server";
import { getGithub } from "@/infrastructure/integrations/github";

export const revalidate = 180;

export async function GET() {
  const data = await getGithub();
  return NextResponse.json({ ok: true, data }, { headers: { "cache-control": "public, max-age=180" } });
}
