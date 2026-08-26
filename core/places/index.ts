import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import type { Place } from "./schedule";

/**
 * Places that matter — home, the gym, the office.
 *
 * Stored as Event rows rather than a new table, the way everything else in
 * SAGE is: the universal store means no migration, and a place is exactly the
 * kind of low-volume, schema-light record it was built for.
 *
 * The point is not a bookmark list. A place with a schedule lets SAGE answer
 * "it is gym time and you are not at the gym" — which is the difference
 * between a map that shows where things are and one that knows what you are
 * supposed to be doing.
 */

const TYPE = "place.saved";


export async function listPlaces(): Promise<Place[]> {
  const { data } = await db
    .from("Event")
    .select("payload")
    .eq("userId", DEFAULT_USER_ID)
    .eq("type", TYPE)
    .order("createdAt", { ascending: true })
    .limit(200);
  return (data ?? []).map((r) => r.payload as Place);
}

export async function savePlace(input: Omit<Place, "id" | "at">): Promise<Place | null> {
  // Coordinates are the one thing that must be right — a place at (0,0) is a
  // marker in the Atlantic, and it would look like a rendering bug rather
  // than bad input.
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lon)) return null;
  if (Math.abs(input.lat) > 90 || Math.abs(input.lon) > 180) return null;

  const place: Place = {
    id: crypto.randomUUID(),
    name: input.name.trim().slice(0, 80) || "Unnamed",
    lat: input.lat,
    lon: input.lon,
    ...(input.kind ? { kind: input.kind.trim().slice(0, 24) } : {}),
    ...(input.schedule ? { schedule: input.schedule } : {}),
    at: new Date().toISOString(),
  };

  const { error } = await db
    .from("Event")
    .insert({ id: place.id, userId: DEFAULT_USER_ID, type: TYPE, payload: place });
  return error ? null : place;
}

export async function deletePlace(id: string): Promise<boolean> {
  const { error } = await db.from("Event").delete().eq("id", id).eq("type", TYPE).eq("userId", DEFAULT_USER_ID);
  return !error;
}


export * from "./schedule";
