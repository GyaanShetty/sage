import { NextResponse } from "next/server";
import { listKeys, addKey, removeKey, keyStorageAvailable, PROVIDERS, type Provider } from "@/core/ops/keys";
import { invalidateKeys, refreshKeys } from "@/infrastructure/llm";

export const dynamic = "force-dynamic";

/**
 * Managing keys without a deploy.
 *
 * Nothing here ever returns key material — the listing is tails only. That is
 * not a formality: this route sits behind the same password as everything
 * else, and a page that could read back a key would turn one leaked session
 * into a leaked Google account.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    data: {
      keys: await listKeys().catch(() => []),
      storageAvailable: keyStorageAvailable(),
      providers: PROVIDERS,
    },
  });
}

export async function POST(req: Request) {
  const { provider, key, label } = (await req.json().catch(() => ({}))) as
    { provider?: string; key?: string; label?: string };

  if (!provider || !PROVIDERS.includes(provider as Provider)) {
    return NextResponse.json({ ok: false, error: "Unknown provider." }, { status: 400 });
  }
  if (!key) return NextResponse.json({ ok: false, error: "key required" }, { status: 400 });

  const result = await addKey(provider as Provider, key, label);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });

  // Take effect now rather than within the cache's minute — he has just pasted
  // this because something is broken, and waiting is the wrong answer.
  invalidateKeys();
  await refreshKeys(true).catch(() => undefined);

  return NextResponse.json({ ok: true, data: { tail: result.tail, keys: await listKeys() } });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  await removeKey(id);
  invalidateKeys();
  await refreshKeys(true).catch(() => undefined);
  return NextResponse.json({ ok: true, data: { keys: await listKeys() } });
}
