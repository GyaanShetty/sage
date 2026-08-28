import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { listPlaces } from "@/core/places";
import { distanceM, AT_PLACE_M, type Place } from "@/core/places/schedule";

/**
 * Where he is.
 *
 * The webhook at app/api/webhook/location has been receiving arrive/leave
 * events from iPhone Shortcuts since it was written, storing them as
 * `location.update` rows — and **nothing has ever read them**. Retention
 * deletes them after seven days. The always-on half of location awareness was
 * already built and completely inert; this is the half that uses it.
 *
 * The browser posts to the same webhook while a tab is open, so both sources
 * land in one store and there is a single answer to give rather than two that
 * can disagree.
 *
 * ── On staleness ───────────────────────────────────────────────────────────
 *
 * `ageMin` is returned, never hidden, and callers are expected to say it out
 * loud. "At the gym, four minutes ago" and "last seen at home, six hours ago"
 * are completely different claims, and presenting the second as the first is
 * how an assistant ends up confidently telling you to leave for somewhere you
 * are already standing. A stale fix is not a wrong fix; a stale fix presented
 * as current is.
 */

export interface Fix {
  lat: number;
  lon: number;
  /** The label the phone sent, when it sent one ("Home", "Gym"). */
  label?: string;
  /** "arrive" | "leave", from the Shortcuts automation. */
  event?: string;
  at: string;
  /** Minutes since the fix. */
  ageMin: number;
}

export interface Where {
  fix: Fix | null;
  /** The saved place he is at, if the fix is close enough to one. */
  at: Place | null;
  /** The nearest saved place and how far, whether or not he is at it. */
  nearest: { place: Place; meters: number } | null;
  /** True when the fix is old enough that it should be spoken with a caveat. */
  stale: boolean;
}

/** Beyond this a fix describes where he was, not where he is. */
export const STALE_AFTER_MIN = 45;

interface LocationPayload { lat?: number; lon?: number; place?: string; event?: string }

export async function whereIs(): Promise<Where> {
  const [{ data: rows }, places] = await Promise.all([
    db
      .from("Event")
      .select("payload, createdAt")
      .eq("userId", DEFAULT_USER_ID)
      .eq("type", "location.update")
      .order("createdAt", { ascending: false })
      .limit(1),
    listPlaces().catch(() => [] as Place[]),
  ]);

  const row = rows?.[0];
  const p = (row?.payload ?? {}) as LocationPayload;

  // A "leave" event with no coordinates tells us where he is not, which is not
  // a position. Treating it as one would pin him to the place he just left.
  if (!row || typeof p.lat !== "number" || typeof p.lon !== "number") {
    return { fix: null, at: null, nearest: null, stale: true };
  }

  const ageMin = (Date.now() - new Date(row.createdAt as string).getTime()) / 60_000;
  const fix: Fix = { lat: p.lat, lon: p.lon, label: p.place, event: p.event, at: row.createdAt as string, ageMin };

  let nearest: Where["nearest"] = null;
  for (const place of places) {
    const meters = distanceM(fix, place);
    if (!nearest || meters < nearest.meters) nearest = { place, meters };
  }

  return {
    fix,
    at: nearest && nearest.meters <= AT_PLACE_M ? nearest.place : null,
    nearest,
    stale: ageMin > STALE_AFTER_MIN,
  };
}

/**
 * One sentence a model or a voice line can use directly.
 *
 * Built here rather than in each caller so the staleness caveat cannot be
 * dropped by whichever one forgets.
 */
export function describeWhere(w: Where): string {
  if (!w.fix) return "I don't know where you are — no recent location fix.";

  const ago =
    w.fix.ageMin < 2 ? "just now"
    : w.fix.ageMin < 60 ? `${Math.round(w.fix.ageMin)} minutes ago`
    : `${Math.round(w.fix.ageMin / 60)} hours ago`;

  const place =
    w.at ? w.at.name
    : w.nearest ? `${(w.nearest.meters / 1000).toFixed(1)}km from ${w.nearest.place.name}`
    : `${w.fix.lat.toFixed(3)}, ${w.fix.lon.toFixed(3)}`;

  return w.stale
    ? `Last seen at ${place}, ${ago}.`
    : w.at ? `At ${place}, as of ${ago}.`
    : `Near ${place}, as of ${ago}.`;
}
