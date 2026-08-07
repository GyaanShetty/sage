import { proxyFetch } from "@/infrastructure/http/fetch";
import { TZ } from "@/lib/config";

/**
 * Calendars that are not Google's.
 *
 * A timetable, an exam schedule, a fixture list, a society's events — these are
 * published as .ics URLs, need no key, no OAuth and no account, and are the
 * calendars a student actually lives by. Subscribing to one in Google Calendar
 * works but hides it behind Google's own refresh schedule, which for a
 * subscribed feed can be hours; reading it directly means the agenda is right
 * now rather than eventually.
 *
 * This parses only what an agenda needs — when, what, where — and deliberately
 * not the whole of RFC 5545. Recurrence in particular is handled for the
 * common weekly and daily cases, because a timetable is one long RRULE and
 * ignoring it would mean showing a lecture once in January and never again.
 */

export interface IcsEvent {
  uid: string;
  summary: string;
  start: string;        // ISO
  end: string;          // ISO
  allDay: boolean;
  location?: string;
  /** Which feed produced it, for labelling in the agenda. */
  feed?: string;
}

/**
 * Unfold, then split. ICS wraps long lines by starting the continuation with a
 * space or tab, so a URL or a long summary arrives split across lines and
 * naive splitting corrupts it.
 */
function unfold(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n")
    .filter(Boolean);
}

/** `DTSTART;TZID=Asia/Kolkata:20260805T093000` → name, params, value. */
function parseLine(line: string): { name: string; params: Record<string, string>; value: string } | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...rest] = left.split(";");
  const params: Record<string, string> = {};
  for (const p of rest) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/"/g, "");
  }
  return { name: name.toUpperCase(), params, value };
}

/**
 * ICS timestamps come in three flavours: a UTC instant (trailing Z), a
 * floating local time, and a date. A floating time with a TZID belongs to that
 * zone — but converting it properly needs the zone's offset on that date,
 * which is what `zonedToUtc` does rather than assuming the server's offset.
 */
export function parseIcsDate(value: string, tzid?: string): { iso: string; allDay: boolean } | null {
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (date) {
    const [, y, m, d] = date;
    return { iso: `${y}-${m}-${d}T00:00:00.000Z`, allDay: true };
  }

  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!dt) return null;
  const [, y, mo, d, h, mi, s, z] = dt;

  if (z) return { iso: `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`, allDay: false };

  const naive = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  return { iso: zonedToUtc(naive, tzid ?? TZ), allDay: false };
}

/**
 * A wall-clock time in a named zone, as a real instant.
 *
 * Derived rather than hardcoded: formatting the candidate instant back in the
 * target zone shows how far off it is, and correcting by that difference lands
 * on the right moment. This handles zones that are not +05:30 and dates on the
 * other side of a DST boundary, neither of which a fixed offset would.
 */
export function zonedToUtc(naiveLocal: string, timeZone: string): string {
  const guess = new Date(`${naiveLocal}Z`);
  if (Number.isNaN(guess.getTime())) return new Date().toISOString();
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const parts = Object.fromEntries(fmt.formatToParts(guess).map((p) => [p.type, p.value]));
    const asSeen = Date.parse(
      `${parts.year}-${parts.month}-${parts.day}T${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}:${parts.second}Z`,
    );
    return new Date(guess.getTime() - (asSeen - guess.getTime())).toISOString();
  } catch {
    return guess.toISOString();
  }
}

interface RawEvent {
  uid?: string; summary?: string; location?: string;
  start?: { iso: string; allDay: boolean };
  end?: { iso: string; allDay: boolean };
  rrule?: string;
}

/** Parse a calendar into events, expanding simple recurrences over a window. */
export function parseIcs(text: string, opts: { from?: Date; days?: number; feed?: string } = {}): IcsEvent[] {
  const from = opts.from ?? new Date();
  const days = opts.days ?? 30;
  const until = new Date(from.getTime() + days * 86_400_000);

  const out: IcsEvent[] = [];
  let cur: RawEvent | null = null;

  for (const line of unfold(text)) {
    if (line.startsWith("BEGIN:VEVENT")) { cur = {}; continue; }

    if (line.startsWith("END:VEVENT")) {
      if (cur?.start && cur.summary) out.push(...expand(cur, from, until, opts.feed));
      cur = null;
      continue;
    }

    if (!cur) continue;
    const p = parseLine(line);
    if (!p) continue;

    if (p.name === "UID") cur.uid = p.value;
    else if (p.name === "SUMMARY") cur.summary = unescapeText(p.value);
    else if (p.name === "LOCATION") cur.location = unescapeText(p.value);
    else if (p.name === "RRULE") cur.rrule = p.value;
    else if (p.name === "DTSTART") cur.start = parseIcsDate(p.value, p.params.TZID) ?? undefined;
    else if (p.name === "DTEND") cur.end = parseIcsDate(p.value, p.params.TZID) ?? undefined;
  }

  return out
    .filter((e) => new Date(e.start) <= until && new Date(e.end) >= from)
    .sort((a, b) => a.start.localeCompare(b.start));
}

/** ICS escapes commas, semicolons and newlines in text values. */
function unescapeText(v: string): string {
  return v.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}

/** How many occurrences of one recurring event to materialise. */
const MAX_OCCURRENCES = 200;

function expand(e: RawEvent, from: Date, until: Date, feed?: string): IcsEvent[] {
  const start = new Date(e.start!.iso);
  const duration = e.end ? new Date(e.end.iso).getTime() - start.getTime() : 3_600_000;

  const one = (s: Date, i = 0): IcsEvent => ({
    uid: `${e.uid ?? e.summary}${i ? `-${i}` : ""}`,
    summary: e.summary!,
    start: s.toISOString(),
    end: new Date(s.getTime() + duration).toISOString(),
    allDay: e.start!.allDay,
    ...(e.location ? { location: e.location } : {}),
    ...(feed ? { feed } : {}),
  });

  if (!e.rrule) return [one(start)];

  const rule = Object.fromEntries(
    e.rrule.split(";").map((kv) => {
      const [k, v] = kv.split("=");
      return [k.toUpperCase(), v];
    }),
  ) as Record<string, string>;

  const freq = rule.FREQ;
  const interval = Math.max(1, Number(rule.INTERVAL) || 1);
  const ruleUntil = rule.UNTIL ? new Date(parseIcsDate(rule.UNTIL)?.iso ?? until.toISOString()) : null;
  const count = rule.COUNT ? Number(rule.COUNT) : null;
  // Only the frequencies a timetable actually uses. Anything else yields the
  // first occurrence rather than a wrong guess about the rest.
  const stepMs = freq === "DAILY" ? 86_400_000 : freq === "WEEKLY" ? 7 * 86_400_000 : null;
  if (!stepMs) return [one(start)];

  // BYDAY on a weekly rule means several days a week — "MO,WE,FR" is one
  // lecture rule, not three, and dropping it loses two thirds of the timetable.
  const byDay = (rule.BYDAY ?? "").split(",").map((d) => d.trim()).filter(Boolean);
  const dayIndex = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const wanted = byDay.length ? byDay.map((d) => dayIndex.indexOf(d.slice(-2))).filter((i) => i >= 0) : null;

  const events: IcsEvent[] = [];
  let cursor = new Date(start);
  let emitted = 0;

  for (let i = 0; i < MAX_OCCURRENCES && cursor <= until; i++) {
    if (ruleUntil && cursor > ruleUntil) break;
    if (count !== null && emitted >= count) break;

    if (freq === "WEEKLY" && wanted) {
      // Walk the seven days of this week and take the ones the rule names.
      const weekStart = new Date(cursor);
      weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
      for (const dow of wanted) {
        const d = new Date(weekStart);
        d.setUTCDate(weekStart.getUTCDate() + dow);
        d.setUTCHours(start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(), 0);
        if (d < start || d > until) continue;
        if (ruleUntil && d > ruleUntil) continue;
        if (count !== null && emitted >= count) break;
        events.push(one(d, events.length));
        emitted++;
      }
    } else if (cursor >= from) {
      events.push(one(cursor, events.length));
      emitted++;
    }

    cursor = new Date(cursor.getTime() + stepMs * interval);
  }

  return events;
}

/** Fetch and parse one feed. Returns null when the URL cannot be read. */
export async function fetchIcs(url: string, opts: { days?: number; from?: Date; feed?: string } = {}): Promise<IcsEvent[] | null> {
  try {
    // webcal:// is the same thing wearing a different hat — it is what most
    // "subscribe" buttons hand you, and it is not a scheme fetch understands.
    const httpUrl = url.replace(/^webcal:\/\//i, "https://");
    const res = await proxyFetch(httpUrl, {
      headers: { accept: "text/calendar,text/plain,*/*", "user-agent": "SAGE" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) return null;
    return parseIcs(text, opts);
  } catch {
    return null;
  }
}
