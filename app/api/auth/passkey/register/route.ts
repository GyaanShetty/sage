import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type VerifiedRegistrationResponse,
} from "@simplewebauthn/server";
import {
  listPasskeys, savePasskey, relyingParty, RP_NAME,
  CHALLENGE_COOKIE, CHALLENGE_COOKIE_OPTIONS,
} from "@/core/auth/passkeys";
import { SESSION_COOKIE, verifyToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Registering a passkey requires an existing session.
 *
 * The middleware treats everything under /api/auth as public, because the
 * login endpoints have to be reachable by someone who is not yet logged in.
 * That makes this route's own check the only thing standing between a stranger
 * and enrolling their thumb as a permanent key to the account — so it is
 * checked here, explicitly, rather than assumed from the path.
 */
async function authorised(): Promise<boolean> {
  const password = process.env.SAGE_PASSWORD;
  if (!password) return true; // gate disabled (local dev)
  const jar = await cookies();
  return verifyToken(jar.get(SESSION_COOKIE)?.value, password);
}

export async function GET(req: Request) {
  if (!(await authorised())) {
    return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  }

  const { rpID } = relyingParty(req);
  const existing = await listPasskeys();

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: process.env.SAGE_OWNER_NAME?.trim() || "owner",
    userDisplayName: process.env.SAGE_OWNER_NAME?.trim() || "owner",
    attestationType: "none",
    // Offering a device that already holds a key would produce a confusing
    // "you already have one of these" error inside the OS prompt.
    excludeCredentials: existing.map((p) => ({ id: p.id })),
    authenticatorSelection: {
      residentKey: "preferred",
      // The point of this feature is the biometric, not merely possession of
      // the phone. Required means Face ID or a PIN, every time.
      userVerification: "required",
    },
  });

  const res = NextResponse.json({ ok: true, data: options });
  res.cookies.set(CHALLENGE_COOKIE, options.challenge, CHALLENGE_COOKIE_OPTIONS);
  return res;
}

export async function POST(req: Request) {
  if (!(await authorised())) {
    return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  }

  const jar = await cookies();
  const expectedChallenge = jar.get(CHALLENGE_COOKIE)?.value;
  if (!expectedChallenge) {
    return NextResponse.json({ ok: false, error: "That took too long — start again." }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { response?: unknown; label?: string };
  if (!body.response) return NextResponse.json({ ok: false, error: "Nothing to verify." }, { status: 400 });

  const { rpID, origin } = relyingParty(req);

  let verification: VerifiedRegistrationResponse;
  try {
    verification = await verifyRegistrationResponse({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      response: body.response as any,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message.slice(0, 200) }, { status: 400 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ ok: false, error: "That key could not be verified." }, { status: 400 });
  }

  const cred = verification.registrationInfo.credential;
  await savePasskey({
    id: cred.id,
    publicKey: Buffer.from(cred.publicKey).toString("base64url"),
    counter: cred.counter,
    ...(cred.transports ? { transports: cred.transports } : {}),
    label: (body.label ?? "").trim().slice(0, 60) || "This device",
    at: new Date().toISOString(),
    lastUsedAt: null,
  });

  const res = NextResponse.json({ ok: true });
  // Spent. A challenge that outlives its use is a replay waiting to happen.
  res.cookies.delete(CHALLENGE_COOKIE);
  return res;
}
