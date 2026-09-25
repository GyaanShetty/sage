"use client";

/**
 * One request per URL, shared by everyone who asks for it.
 *
 * The dashboard mounts a dozen panels that each want the same handful of
 * readings. Written the obvious way — every panel calling `fetch` in its own
 * effect — a single load asked `/api/markets` six times, `/api/mail` six
 * times, `/api/weather` four times and `/api/atlas/satellites` eight times.
 * Every one of those is a serverless invocation against a rate-limited free
 * tier, so the duplicates are not merely wasteful: they are what exhausts the
 * upstream quota and makes the *first* call fail tomorrow.
 *
 * Two mechanisms, both keyed on the URL:
 *
 *   · In-flight sharing. A second caller during a request in progress gets the
 *     same promise. This is what collapses a mount storm, where a dozen
 *     effects run in the same tick and no response has landed yet.
 *   · A short freshness window. A caller arriving just after a response
 *     landed gets that response instead of a new request. This is what
 *     collapses panels that mount late — a tab becoming visible, a lazy
 *     panel, a route transition back to the dashboard.
 *
 * Deliberately not a cache. Nothing is held beyond `maxAgeMs`, so a live
 * reading stays live and a panel refreshing on its own timer still gets a
 * fresh number. The window only has to be long enough to cover a render pass,
 * not long enough to make data stale.
 */

interface Entry {
  /** The request in progress, if one is. */
  inflight: Promise<unknown> | null;
  /** The last resolved value and when it resolved. */
  value: unknown;
  at: number;
}

/**
 * What every route in this app answers with. Defaulting to it means a caller
 * that just wants `j?.data` does not have to name a type to get one.
 */
export interface Envelope {
  ok?: boolean;
  data?: unknown;
  error?: string;
}

const entries = new Map<string, Entry>();

/** Default window: long enough for one mount pass, short enough to stay live. */
const FRESH_MS = 10_000;

/**
 * `fetch(url).then(r => r.json())`, deduplicated across callers.
 *
 * Rejections are not cached — a failed request leaves nothing behind, so the
 * next caller retries rather than inheriting someone else's bad luck.
 */
export function shareJson<T = Envelope>(url: string, maxAgeMs = FRESH_MS): Promise<T> {
  const now = Date.now();
  const hit = entries.get(url);

  if (hit) {
    if (hit.inflight) return hit.inflight as Promise<T>;
    if (now - hit.at < maxAgeMs) return Promise.resolve(hit.value as T);
  }

  const entry: Entry = hit ?? { inflight: null, value: null, at: 0 };
  entries.set(url, entry);

  entry.inflight = fetch(url, { cache: "no-store" })
    .then((r) => r.json())
    .then((j) => {
      entry.value = j;
      entry.at = Date.now();
      entry.inflight = null;
      return j;
    })
    .catch((e) => {
      // Leave no trace of a failure, so the next caller gets a real attempt.
      entries.delete(url);
      throw e;
    });

  return entry.inflight as Promise<T>;
}

/**
 * Drop what is remembered for a URL, so the next call goes to the network.
 *
 * Needed after a write: posting to /api/spotify and immediately re-reading it
 * would otherwise be answered from the window with the state from before the
 * write, and the transport controls would appear not to work.
 */
export function invalidate(url?: string): void {
  if (url) entries.delete(url);
  else entries.clear();
}
