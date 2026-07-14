import { NextResponse } from "next/server";
import { createThread } from "@/infrastructure/db/threads";

export async function POST() {
  const thread = await createThread();
  return NextResponse.json({ ok: true, data: thread });
}
