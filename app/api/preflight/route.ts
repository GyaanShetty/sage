import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Is this deployment actually wired up?
 *
 * Everything in SAGE degrades rather than crashes when a key is missing, which
 * is the right behaviour and also the reason a half-configured instance can run
 * for a week before anyone notices the reminders never fire. This answers the
 * question directly, in one request.
 *
 * It reports whether each variable is SET, never what it contains. A
 * diagnostic endpoint that echoes secrets is a credential leak with a helpful
 * user interface, and this one is reachable by anyone holding the session
 * cookie.
 */

interface Check { key: string; set: boolean; note: string }

function check(key: string, note: string): Check {
  const v = process.env[key];
  return { key, set: !!v && v.trim().length > 0, note };
}

export async function GET() {
  const required: Check[] = [
    check("NEXT_PUBLIC_SUPABASE_URL", "The database. Nothing works without it."),
    check("SUPABASE_SERVICE_ROLE_KEY", "Server-side database access."),
    check("SAGE_PASSWORD", "The front door. Empty means the app is OPEN TO ANYONE."),
    check("GOOGLE_GENERATIVE_AI_API_KEY", "Any AI feature. Keys added in Settings also count — see keys below."),
  ];

  const scheduled: Check[] = [
    check("CRON_SECRET", "Authenticates the heartbeat. Without it /api/beat refuses every call."),
    check("APP_URL", "Used in links SAGE sends you. Wrong or missing means dead links in notifications."),
  ];

  const durability: Check[] = [
    check("KEY_SECRET", "Encrypts stored API keys at rest. Without it they are stored in the clear."),
    check("BACKUP_REPO", "Nightly export of every table. Without it there is no backup at all."),
    check("GITHUB_TOKEN", "Needed by both the backup and the code pusher."),
  ];

  const optional: Check[] = [
    check("GOOGLE_OAUTH_CLIENT_ID", "Gmail and Calendar."),
    check("ELEVENLABS_API_KEY", "Neural voice. Falls back to the browser's own."),
    check("VAPID_PUBLIC_KEY", "Push notifications to the phone."),
    check("TAVILY_API_KEY", "Web research."),
    check("ALPHAVANTAGE_KEY", "Stock prices."),
    check("HEVY_API_KEY", "Workout sync."),
  ];

  // ── live state, not just configuration ───────────────────────────────────
  let database = "unreachable";
  let keys = 0;
  let lastBeat: string | null = null;
  let beatAgeMin: number | null = null;

  try {
    const { db, DEFAULT_USER_ID } = await import("@/infrastructure/db/supabase");
    const { error } = await db.from("Event").select("id", { head: true, count: "exact" }).limit(1);
    database = error ? `error: ${error.message.slice(0, 120)}` : "ok";

    // Counts and nothing else — never the key material, not even masked here.
    const { listKeys } = await import("@/core/ops/keys");
    keys = (await listKeys().catch(() => [])).length;

    // The heartbeat keeps one row: a map of job name → when it last ran. Its
    // own createdAt is when that row was first written, which would report a
    // heartbeat that died months ago as perfectly healthy — so the freshest
    // timestamp inside the payload is the one that means anything.
    const { data } = await db
      .from("Event").select("payload")
      .eq("userId", DEFAULT_USER_ID).eq("type", "ops.lastrun")
      .order("createdAt", { ascending: false }).limit(1).maybeSingle();

    const runs = Object.values((data?.payload ?? {}) as Record<string, string>)
      .map((iso) => new Date(iso).getTime())
      .filter((t) => Number.isFinite(t));
    if (runs.length) {
      lastBeat = new Date(Math.max(...runs)).toISOString();
      beatAgeMin = Math.round((Date.now() - Math.max(...runs)) / 60_000);
    }
  } catch (e) {
    database = `error: ${(e as Error).message.slice(0, 120)}`;
  }

  const missingRequired = required.filter((c) => !c.set).map((c) => c.key);
  // A heartbeat that last ran an hour ago is not running. Reminders are
  // supposed to be checked every minute.
  const heartbeatHealthy = beatAgeMin !== null && beatAgeMin < 15;

  const verdict =
    missingRequired.length > 0
      ? `Not ready: ${missingRequired.join(", ")} ${missingRequired.length === 1 ? "is" : "are"} missing.`
      : database !== "ok"
        ? "The database is not answering. Everything else is moot until it does."
        : !heartbeatHealthy
          ? "Configured, but nothing is driving the clock — no reminders, price alerts or night shift. Deploy the heartbeat worker (ops/heartbeat-worker)."
          : "Ready.";

  return NextResponse.json({
    ok: missingRequired.length === 0 && database === "ok",
    data: {
      verdict,
      database,
      storedKeys: keys,
      heartbeat: { lastBeat, ageMinutes: beatAgeMin, healthy: heartbeatHealthy },
      required, scheduled, durability, optional,
    },
  });
}
