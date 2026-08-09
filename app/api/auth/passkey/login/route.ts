import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedAuthenticationResponse,
} from "@simplewebauthn/server";
import {
  listPasskeys, touchPasskey, relyingParty,
  CHALLENGE_COOKIE, CHALLENGE_COOKIE_OPTIONS,
} from "@/core/auth/passkeys";
import {
  SESSION_COOKIE, COOKIE_OPTIONS, SESSION_MAX_AGE_SECONDS, issueToken,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Signing in with a passkey.
 *
 * Public by necessity — nobody holds a session yet. What protects it is the
 * cryptography rather than the gate: the response has to carry a signature
 * over this exact challenge, from a private key that never left the device,
 * and the browser will only produce one for the origin it was registered to.
 *
 * Throttled anyway. An unauthenticated endpoint that touches the database is
 * worth a limit even when guessing it is not the threat.
 */
const attempts = new Map<string, { count: number; until: number }>();
const WINDOW_MS = 10 * 60_000;
const FREE = 10;

function clientKey(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || "unknown";
}

function throttled(req: Request): boolean {
  const key = clientKey(req);
  const now = Date.now();
  const rec = attempts.get(key);
  if (rec && rec.until > now) return true;
  if (!rec || now - rec.until > WINDOW_MS) attempts.set(key, { count: 0, until: 0 });
  return false;
}

function note(req: Request) {
  const key = clientKey(req);
  const rec = attempts.get(key) ?? { count: 0, until: 0 };
  rec.count += 1;
  if (rec.count > FREE) rec.until = Date.now() + Math.min(300_000, (rec.count - FREE) ** 2 * 1000);
  attempts.set(key, rec);
}

export async function GET(req: Request) {
  if (throttled(req)) return NextResponse.json({ ok: false, error: "Too many attempts." }, { status: 429 });

  const { rpID } = relyingParty(req);
  const keys = await listPasskeys();
  if (keys.length === 0) {
    return NextResponse.json({ ok: false, error: "No passkey is registered on this account yet." }, { status: 404 });
  }

  const options = await generateAuthenticationOptions({
    rpID,
    // Credential IDs are not secrets — the spec treats them as public — and
    // naming them keeps sign-in working with authenticators that did not store
    // a discoverable credential.
    allowCredentials: keys.map((k) => ({
      id: k.id,
      ...(k.transports ? { transports: k.transports as AuthenticatorTransport[] } : {}),
    })),
    userVerification: "required",
  });

  const res = NextResponse.json({ ok: true, data: options });
  res.cookies.set(CHALLENGE_COOKIE, options.challenge, CHALLENGE_COOKIE_OPTIONS);
  return res;
}

export async function POST(req: Request) {
  if (throttled(req)) return NextResponse.json({ ok: false, error: "Too many attempts." }, { status: 429 });
  note(req);

  const password = process.env.SAGE_PASSWORD;
  if (!password) return NextResponse.json({ ok: true }); // gate disabled

  const jar = await cookies();
  const expectedChallenge = jar.get(CHALLENGE_COOKIE)?.value;
  if (!expectedChallenge) {
    return NextResponse.json({ ok: false, error: "That took too long — try again." }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { response?: { id?: string } };
  const id = body.response?.id;
  if (!id) return NextResponse.json({ ok: false, error: "Nothing to verify." }, { status: 400 });

  const stored = (await listPasskeys()).find((k) => k.id === id);
  if (!stored) return NextResponse.json({ ok: false, error: "That key is not registered." }, { status: 401 });

  const { rpID, origin } = relyingParty(req);

  let verification: VerifiedAuthenticationResponse;
  try {
    verification = await verifyAuthenticationResponse({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      response: body.response as any,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: stored.id,
        publicKey: new Uint8Array(Buffer.from(stored.publicKey, "base64url")),
        counter: stored.counter,
        ...(stored.transports ? { transports: stored.transports as AuthenticatorTransport[] } : {}),
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message.slice(0, 200) }, { status: 401 });
  }

  if (!verification.verified) {
    return NextResponse.json({ ok: false, error: "That signature did not check out." }, { status: 401 });
  }

  await touchPasskey(stored.id, verification.authenticationInfo.newCounter).catch(() => undefined);

  // The same session token the password issues, so everything downstream —
  // middleware, expiry, the revocation epoch — behaves identically.
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await issueToken(password), {
    ...COOKIE_OPTIONS,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  res.cookies.delete(CHALLENGE_COOKIE);
  attempts.delete(clientKey(req));
  return res;
}
