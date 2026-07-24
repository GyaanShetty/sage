import { NextResponse } from "next/server";
import type { PushSubscription } from "web-push";
import { pushPublicKey, saveSubscription, sendPush } from "@/infrastructure/push";

/** GET → the VAPID public key (needed client-side to subscribe). */
export async function GET() {
  const key = pushPublicKey();
  return NextResponse.json({ ok: true, data: { publicKey: key, enabled: !!key } });
}

/** POST → register a device subscription. `?test=1` also fires a test push. */
export async function POST(req: Request) {
  const sub = (await req.json().catch(() => null)) as PushSubscription | null;
  if (!sub?.endpoint) return NextResponse.json({ ok: false, error: "bad subscription" }, { status: 400 });
  await saveSubscription(sub);
  if (new URL(req.url).searchParams.get("test") === "1") {
    await sendPush({ title: "SAGE online", body: "Notifications are live, sir. I'll keep you posted.", tag: "sage-test" }).catch(() => 0);
  }
  return NextResponse.json({ ok: true });
}
