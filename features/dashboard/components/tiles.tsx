"use client";

import { useState } from "react";
import Image from "next/image";
import { Pane, Row, Empty } from "@/components/pane";
import { BarStrip, Progress, Delta } from "@/components/instruments";
import { useLive } from "@/lib/live";
import { TZ } from "@/lib/config";
import { asArray } from "@/lib/as-array";

/**
 * Terminal tiles.
 *
 * Every one of these is a re-presentation of data SAGE already produces — the
 * sky endpoint, the weather, the APOD, Spotify. None of them adds a new
 * upstream; the density comes from showing what is already known, tightly,
 * rather than from fetching more.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/* ── CHRONO ───────────────────────────────────────────────────────────────
   Where you are in the day, the week and the year. A clock tells you the
   time; this tells you how much of the thing is left, which is the question
   actually being asked when someone glances at a clock. */
export function ChronoTile({ n }: { n?: number }) {
  const [now, setNow] = useState<Date | null>(null);
  const [sun, setSun] = useState<{ sunrise: string; sunset: string } | null>(null);

  useLive(() => { setNow(new Date()); }, { everyMs: 1000, hiddenMs: 60_000 });
  useLive(
    () => fetch("/api/sky").then((r) => r.json()).then((j) => setSun(j?.data?.sun ?? null)).catch(() => {}),
    { everyMs: 1_800_000 },
  );

  const t = (d: Date, o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour12: false, ...o }).format(d);

  // Day fraction in IST, from the zone's own parts rather than local getHours.
  let dayPct = 0, hhmm = "--:--", ss = "--", stamp = "";
  let week = 0, doy = 0, quarter = 0;
  if (now) {
    const p = new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(now);
    const get = (ty: string) => Number(p.find((x) => x.type === ty)?.value ?? 0);
    const h = get("hour") % 24, m = get("minute"), s = get("second");
    dayPct = (h * 3600 + m * 60 + s) / 86400;
    hhmm = `${pad(h)}:${pad(m)}`;
    ss = pad(s);
    stamp = t(now, { weekday: "long", day: "2-digit", month: "short", year: "numeric" }).toUpperCase();

    const y = Number(t(now, { year: "numeric" }));
    const jan1 = Date.UTC(y, 0, 1);
    const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);
    const todayUtc = Date.parse(`${dayKey}T00:00:00Z`);
    doy = Math.floor((todayUtc - jan1) / 86400000) + 1;
    week = Math.ceil(doy / 7);
    quarter = Math.floor(new Date(todayUtc).getUTCMonth() / 3) + 1;
  }

  const clock = (iso?: string) => (iso ? t(new Date(iso), { hour: "2-digit", minute: "2-digit" }) : "—");

  return (
    <Pane n={n} title="Chrono" status="UTC+5:30">
      <div className="chrono-time">
        <span className="ct-hm">{hhmm}</span>
        <span className="ct-ss">{ss}</span>
      </div>
      <div className="chrono-date">{stamp || "—"}</div>
      <Progress pct={dayPct} left={`DAY ${(dayPct * 100).toFixed(1)}%`} right={sun ? `↑${clock(sun.sunrise)}  ↓${clock(sun.sunset)}` : undefined} />
      <div className="chrono-figs">
        <span><b>{week || "—"}</b><i>WEEK</i></span>
        <span><b>{doy || "—"}</b><i>D/Y</i></span>
        <span><b>Q{quarter || "—"}</b><i>QTR</i></span>
      </div>
    </Pane>
  );
}

/* ── FIELD MONITOR ────────────────────────────────────────────────────────
   Conditions around him: weather now and the hours ahead, and what is in the
   sky overhead. Two feeds that were already being fetched for other panels. */
interface Weather { place: string; temp: number; label: string; high: number; low: number; aqi?: number; wind?: number; humidity?: number; pressure?: number; hourly?: { temp: number[] } }

export function FieldTile({ n }: { n?: number }) {
  const [w, setW] = useState<Weather | null>(null);
  const [planes, setPlanes] = useState<number | null>(null);
  const [iss, setIss] = useState<{ alt: number; vel: number } | null>(null);

  useLive(
    () => fetch("/api/weather").then((r) => r.json()).then((j) => setW(j?.data ?? null)).catch(() => {}),
    { everyMs: 600_000 },
  );
  useLive(
    () => fetch("/api/sky").then((r) => r.json()).then((j) => {
      setPlanes(j?.data?.planes?.length ?? null);
      setIss(j?.data?.iss ?? null);
    }).catch(() => {}),
    { everyMs: 60_000 },
  );

  return (
    <Pane n={n} title="Field Monitor" status={w?.place?.toUpperCase() ?? "—"} live={!!w}>
      <Row k="Temp" v={w ? `${w.temp}°` : "—"} tone="signal" />
      <Row k="Condition" v={w ? w.label.toUpperCase() : "—"} />
      <Row k="High / Low" v={w ? `${w.high}° / ${w.low}°` : "—"} />
      {w?.humidity != null && <Row k="Humidity" v={`${w.humidity}%`} />}
      {w?.wind != null && <Row k="Wind" v={`${Math.round(w.wind)} KM/H`} />}
      {w?.aqi != null && <Row k="AQI" v={String(w.aqi)} tone={w.aqi >= 150 ? "down" : w.aqi >= 100 ? "signal" : "up"} />}
      {w?.hourly?.temp?.length ? (
        <>
          <div className="tile-cap">NEXT 12H</div>
          <BarStrip data={w.hourly.temp} height={26} />
        </>
      ) : null}
      <Row k="Aircraft overhead" v={planes != null ? String(planes) : "—"} />
      <Row k="ISS" v={iss ? `${Math.round(iss.alt)} KM · ${Math.round(iss.vel).toLocaleString("en-IN")} KM/H` : "—"} tone="muted" />
    </Pane>
  );
}

/* ── COSMOS ───────────────────────────────────────────────────────────────
   NASA's picture of the day. One of the few tiles that earns a large image. */
export function CosmosTile({ n }: { n?: number }) {
  const [a, setA] = useState<{ title: string; url: string; explanation: string; date: string } | null | undefined>(undefined);

  useLive(
    () => fetch("/api/cosmos").then((r) => r.json()).then((j) => setA(j?.data ?? null)).catch(() => setA(null)),
    { everyMs: 3_600_000 },
  );

  return (
    <Pane n={n} title="Cosmos" status={a ? `NASA APOD ${a.date}` : "NASA APOD"}>
      {a === undefined && <div className="tile-wait">ACQUIRING…</div>}
      {a === null && <div className="tile-wait">UNAVAILABLE</div>}
      {a && (
        <div className="cosmos">
          {/* Remote host, unknown dimensions, and APOD occasionally serves a
              video URL — so it is a plain img behind a load guard rather than
              next/image with a domain allowlist to maintain. */}
          {/^https?:\/\/\S+\.(jpg|jpeg|png|gif)$/i.test(a.url) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="cosmos-img" src={a.url} alt="" loading="lazy" />
          )}
          <div className="cosmos-txt">
            <div className="cosmos-t">{a.title}</div>
            <p className="cosmos-p">{a.explanation}</p>
          </div>
        </div>
      )}
    </Pane>
  );
}

/* ── NOW PLAYING ──────────────────────────────────────────────────────────
   Spotify, already wired. The progress bar is real progress. */
export function PlayingTile({ n }: { n?: number }) {
  const [p, setP] = useState<{ playing: boolean; track: string; artist: string; art: string | null; progress: number; duration: number } | null>(null);

  useLive(
    () => fetch("/api/spotify").then((r) => r.json()).then((j) => setP(j?.data ?? null)).catch(() => {}),
    { everyMs: 20_000, hiddenMs: 300_000 },
  );

  const ms = (v: number) => `${Math.floor(v / 60000)}:${pad(Math.floor((v % 60000) / 1000))}`;

  return (
    <Pane n={n} title="Now Playing" status={p?.playing ? "LIVE" : "IDLE"} live={!!p?.playing}>
      {!p?.playing && <Empty reason="Nothing playing" action="Open Spotify" href="https://open.spotify.com" />}
      {p?.playing && (
        <div className="np">
          {p.art && (
            <Image className="np-art" src={p.art} alt="" width={44} height={44} unoptimized />
          )}
          <div className="np-txt">
            <div className="np-t">{p.track}</div>
            <div className="np-a">{p.artist.toUpperCase()}</div>
          </div>
        </div>
      )}
      {p?.playing && p.duration > 0 && (
        <Progress pct={p.progress / p.duration} left={ms(p.progress)} right={ms(p.duration)} />
      )}
    </Pane>
  );
}

/* ── WIRE ─────────────────────────────────────────────────────────────────
   Headlines, source-tagged. The source label is the point: a headline
   without its publisher is a rumour. */
export function WireTile({ n, source = "hindu" }: { n?: number; source?: string }) {
  const [items, setItems] = useState<{ title: string; link: string; source?: string }[] | null>(null);

  useLive(
    () => fetch(`/api/feeds?source=${source}`).then((r) => r.json())
      .then((j) => setItems(asArray(j?.data?.items))).catch(() => setItems([])),
    { everyMs: 900_000 },
  );

  return (
    <Pane n={n} title="Wire" status={items ? `${items.length} ITEMS` : "…"} live={!!items?.length}>
      {!items && <div className="tile-wait">ACQUIRING…</div>}
      {items?.length === 0 && <Empty reason="No headlines" action="Open the wire" href="/wire" />}
      {items?.slice(0, 8).map((it, i) => (
        <a className="wire-row" key={i} href={it.link} target="_blank" rel="noreferrer">
          <span className="wire-n">{pad(i + 1)}</span>
          <span className="wire-t">{it.title}</span>
        </a>
      ))}
    </Pane>
  );
}

export { Delta };
