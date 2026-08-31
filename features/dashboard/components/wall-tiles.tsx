"use client";

import { useState } from "react";
import Link from "next/link";
import { Pane, Row, Stat } from "@/components/pane";
import { Wave, BarStrip } from "@/components/instruments";
import { useLive } from "@/lib/live";
import { asArray } from "@/lib/as-array";
import { TZ } from "@/lib/config";

/**
 * The panes the wall needed that did not exist yet.
 *
 * Every one of them reads an endpoint SAGE already serves. That is the
 * constraint the whole dashboard is built on: density comes from showing what
 * is already known, tightly — not from adding upstreams, which on a free tier
 * is also how the budget dies.
 */

const pad = (n: number) => String(n).padStart(2, "0");

function Go({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link className="pane-go" href={href}>{children}</Link>;
}

/* ── 02 MARKETS ───────────────────────────────────────────────────────────
   Crypto with sparklines, then equities, then FX. Three endpoints that were
   already being fetched by the markets page. */
interface Coin { symbol: string; price: number; change24h: number; spark?: number[] }
interface Quote { symbol: string; name?: string; price: number; changePct: number; currency?: string }
interface Fx { pair: string; rate: number; changePct?: number }

const money = (v: number, cur = "$") =>
  `${cur}${v >= 1000 ? Math.round(v).toLocaleString("en-IN") : v.toFixed(2)}`;

export function MarketsTile({ n }: { n?: number }) {
  const [coins, setCoins] = useState<Coin[]>([]);
  const [stocks, setStocks] = useState<Quote[]>([]);
  const [fx, setFx] = useState<Fx[]>([]);

  useLive(() => Promise.all([
    fetch("/api/markets").then((r) => r.json()).then((j) => setCoins(asArray<Coin>(j?.data))),
    fetch("/api/stocks").then((r) => r.json()).then((j) => setStocks(asArray<Quote>(j?.data))),
    fetch("/api/fx").then((r) => r.json()).then((j) => setFx(asArray<Fx>(j?.data))),
  ]).then(() => {}).catch(() => {}), { everyMs: 120_000 });

  return (
    <Pane n={n} title="Markets" status={<Go href="/markets">LIVE</Go>} live={coins.length > 0}>
      <div className="mk-grid">
        {coins.slice(0, 4).map((c) => (
          <div className="mk-cell" key={c.symbol}>
            <div className="mk-h">{c.symbol} / USD</div>
            <div className="mk-p">{money(c.price)}</div>
            {c.spark?.length ? <Wave data={c.spark} height={22} tone={c.change24h >= 0 ? "var(--live)" : "var(--danger)"} /> : null}
            <div className={`mk-c ${c.change24h >= 0 ? "up" : "down"}`}>
              {c.change24h >= 0 ? "▲" : "▽"}{Math.abs(c.change24h).toFixed(1)}%
            </div>
          </div>
        ))}
      </div>

      {stocks.length > 0 && (
        <>
          <div className="tile-cap">EQUITIES</div>
          {stocks.slice(0, 3).map((s) => (
            <Row
              key={s.symbol}
              k={s.name?.slice(0, 18) ?? s.symbol}
              v={<>{money(s.price, s.currency === "INR" ? "₹" : "$")} <b className={s.changePct >= 0 ? "up" : "down"}>{s.changePct >= 0 ? "▲" : "▽"}{Math.abs(s.changePct).toFixed(1)}%</b></>}
            />
          ))}
        </>
      )}

      {fx.length > 0 && (
        <>
          <div className="tile-cap">CURRENCY · INR</div>
          {fx.slice(0, 4).map((f) => (
            <Row key={f.pair} k={f.pair} v={`₹${f.rate.toFixed(2)}`} />
          ))}
        </>
      )}
    </Pane>
  );
}

/* ── 03 KEY METRICS ───────────────────────────────────────────────────────
   The nine-figure grid. Every cell is a number shown elsewhere on the screen;
   this is the summary you read first and the panes are where you go for the
   why. */
export function KeyMetricsTile({
  n, week, doy, quarter, open, focusMin,
}: { n?: number; week: number; doy: number; quarter: number; open: number; focusMin: number }) {
  const [v, setV] = useState<{ keys: { healthy: boolean }[]; healthyKeys: number } | null>(null);
  const [signals, setSignals] = useState<number | null>(null);
  const [latency, setLatency] = useState<number | null>(null);

  /**
   * Latency is measured, not reported.
   *
   * The mock has LATENCY / CPU / MEM. SAGE runs on Vercel functions and has no
   * access to a host's CPU or memory, so those two would have to be invented —
   * and an invented gauge next to eight real ones poisons all nine. Round-trip
   * time to SAGE's own health endpoint is a real number about a real thing, so
   * that is what this shows.
   */
  useLive(async () => {
    const t0 = performance.now();
    const j = await fetch("/api/vitals").then((r) => r.json()).catch(() => null);
    setLatency(Math.round(performance.now() - t0));
    if (j?.data) setV(j.data);
  }, { everyMs: 60_000 });
  useLive(
    () => fetch("/api/sitrep/live").then((r) => r.json())
      .then((j) => setSignals(asArray(j?.data?.sitrep?.lines).length)).catch(() => {}),
    { everyMs: 60_000 },
  );

  return (
    <Pane n={n} title="Key Metrics">
      <div className="km">
        <Stat v={pad(week)} k="Week" />
        <Stat v={pad(doy)} k="Day" />
        <Stat v={`Q${quarter}`} k="Qtr" />
        <Stat v={pad(open)} k="Tasks" />
        <Stat v={signals != null ? pad(signals) : "—"} k="Signals" />
        <Stat v={`${Math.floor(focusMin / 60)}H${pad(focusMin % 60)}`} k="Focus" />
        <Stat v={latency != null ? `${latency}MS` : "—"} k="Latency" tone={latency != null && latency < 600 ? "up" : "signal"} />
        <Stat v={v ? `${v.healthyKeys}/${v.keys.length}` : "—"} k="Keys" />
        <Stat v={v ? (v.healthyKeys === v.keys.length ? "OK" : "DEG") : "—"} k="Models" tone={v && v.healthyKeys < v.keys.length ? "down" : "up"} />
      </div>
    </Pane>
  );
}

/* ── 05 HEALTH ────────────────────────────────────────────────────────────
   Four traces rather than four numbers. A resting heart rate of 68 means
   nothing on its own; 68 against the last fortnight means something. */
interface HealthDay { day: string; restingHr?: number; spo2?: number; sleepHours?: number; activeKcal?: number; steps?: number }

export function HealthTile({ n }: { n?: number }) {
  const [series, setSeries] = useState<HealthDay[] | null>(null);

  useLive(
    () => fetch("/api/health").then((r) => r.json())
      .then((j) => setSeries(asArray<HealthDay>(j?.data?.series))).catch(() => setSeries([])),
    { everyMs: 900_000 },
  );

  const col = (k: keyof HealthDay) =>
    (series ?? []).map((d) => Number(d[k] ?? 0)).filter((x) => Number.isFinite(x));

  const trace = (label: string, k: keyof HealthDay, unit: string, tone: string) => {
    const data = col(k);
    const last = data.length ? data[data.length - 1] : null;
    return (
      <div className="hz" key={label}>
        <div className="hz-h">
          <span className="hz-k">{label}</span>
          <span className="hz-v">{last != null ? `${Math.round(last)}${unit}` : "—"}</span>
        </div>
        {data.length > 1 && <Wave data={data} height={22} tone={tone} />}
      </div>
    );
  };

  return (
    <Pane n={n} title="Health" status={<Go href="/health">{series?.length ? "LIVE" : "…"}</Go>} live={!!series?.length}>
      {series?.length === 0 && <div className="tile-wait">NO HEALTH DATA SYNCED</div>}
      {trace("Heart rate", "restingHr", " BPM", "var(--live)")}
      {trace("Blood oxygen", "spo2", "%", "var(--signal)")}
      {trace("Sleep", "sleepHours", " H", "var(--muted)")}
      {trace("Energy", "activeKcal", " KCAL", "var(--live)")}
    </Pane>
  );
}

/* ── 07 SYSTEM ACTIVITY ───────────────────────────────────────────────────
   Events per day for the last week. The day keys come from the API in IST;
   deriving them here from toISOString would shift every bar by 5h30 and put
   late-evening activity on the wrong day. */
export function ActivityTile({ n }: { n?: number }) {
  const [days, setDays] = useState<{ day: string; count: number }[] | null>(null);

  useLive(
    () => fetch("/api/events/daily").then((r) => r.json())
      .then((j) => setDays(asArray<{ day: string; count: number }>(j?.data))).catch(() => setDays([])),
    { everyMs: 300_000 },
  );

  const label = (day: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short" })
      .format(new Date(`${day}T12:00:00Z`)).toUpperCase();

  const rows = days ?? [];
  const peak = Math.max(1, ...rows.map((d) => d.count));

  return (
    <Pane n={n} title="System Activity" status="EVENTS / DAY">
      {rows.length === 0 && <div className="tile-wait">NO ACTIVITY RECORDED</div>}
      <div className="acts">
        {rows.map((d) => (
          <div className="act" key={d.day}>
            <span className="act-n">{d.count}</span>
            <span className="act-b" style={{ height: `${(d.count / peak) * 100}%` }} />
            <span className="act-k">{label(d.day)}</span>
          </div>
        ))}
      </div>
    </Pane>
  );
}

/* ── 09 MISSION CONTROL ───────────────────────────────────────────────────
   The summary column: one line each for the things that would otherwise send
   you hunting across the screen. */
export function MissionTile({
  n, open, events, agentRunning, memories, runs, weather,
}: {
  n?: number; open: number; events: number; agentRunning: boolean;
  memories: number; runs: number; weather: string | null;
}) {
  const [btc, setBtc] = useState<number | null>(null);
  const [unread, setUnread] = useState<number | null>(null);
  const [budget, setBudget] = useState<{ spent: number; total: number } | null>(null);

  useLive(() => fetch("/api/markets").then((r) => r.json())
    .then((j) => setBtc(asArray<Coin>(j?.data).find((c) => c.symbol === "BTC")?.price ?? null)).catch(() => {}),
    { everyMs: 120_000 });
  useLive(() => fetch("/api/mail?box=unread").then((r) => r.json())
    .then((j) => setUnread(asArray(j?.data?.messages).length)).catch(() => {}), { everyMs: 300_000 });
  useLive(() => fetch("/api/budget").then((r) => r.json())
    .then((j) => {
      const st = j?.data?.status;
      setBudget(st?.totalSpent != null ? { spent: st.totalSpent, total: st.totalBudget } : null);
    }).catch(() => {}), { everyMs: 600_000 });

  return (
    <Pane n={n} title="Mission Control">
      <Row k="Tasks" v={`${open} open`} />
      {budget && <Row k="Budget" v={`₹${Math.round(budget.spent).toLocaleString("en-IN")} of ₹${Math.round(budget.total).toLocaleString("en-IN")}`} />}
      <Row k="BTC" v={btc != null ? money(btc) : "—"} />
      <Row k="Events" v={`${events} today`} />
      <Row k="Inbox" v={unread != null ? `${unread} unread` : "—"} />
      <Row k="Memory" v={`${memories.toLocaleString("en-IN")} held`} />
      <Row k="Agent" v={agentRunning ? "Running" : `${runs} runs`} tone={agentRunning ? "signal" : "muted"} />
      {weather && <Row k="Outside" v={weather.toUpperCase()} />}
      <Row k="Sage" v="Nominal" tone="muted" />
    </Pane>
  );
}

/* ── 12 FEEDS ─────────────────────────────────────────────────────────────
   Watchlist with thumbnails. A row whose feed carries no image renders
   without art rather than with a grey placeholder box — an empty frame reads
   as a broken image, which is worse than no frame. */
interface Video { title: string; channel?: string; url: string; thumb?: string | null; publishedAt?: string }

export function FeedsTile({ n }: { n?: number }) {
  const [items, setItems] = useState<Video[] | null>(null);

  useLive(
    () => fetch("/api/youtube").then((r) => r.json())
      .then((j) => setItems(asArray<Video>(j?.data?.videos))).catch(() => setItems([])),
    { everyMs: 900_000 },
  );

  return (
    <Pane n={n} title="Feeds" status={<Go href="/wire">See all</Go>}>
      {!items && <div className="tile-wait">ACQUIRING…</div>}
      {items?.length === 0 && <div className="tile-wait">NO ITEMS</div>}
      {items?.slice(0, 4).map((v, i) => (
        <a className="vid" key={i} href={v.url} target="_blank" rel="noreferrer">
          {v.thumb && (
            // Remote thumbnails from arbitrary feed hosts — a plain img rather
            // than next/image with a domain allowlist to keep in sync.
            // eslint-disable-next-line @next/next/no-img-element
            <span className="vid-th"><img src={v.thumb} alt="" loading="lazy" /></span>
          )}
          <span className="vid-tx">
            <span className="vid-t">{v.title}</span>
            {v.channel && <span className="vid-c">{v.channel}</span>}
          </span>
        </a>
      ))}
    </Pane>
  );
}

/* ── 15 WORLD CLOCKS ──────────────────────────────────────────────────────
   Analog, because the shape of a clock face is read faster than digits when
   the only question is "is it a reasonable hour to message them". */
const ZONES: { zone: string; label: string }[] = [
  { zone: TZ, label: "Bengaluru" },
  { zone: "Europe/London", label: "London" },
  { zone: "Asia/Tokyo", label: "Tokyo" },
];

export function ClocksTile({ n }: { n?: number }) {
  const [now, setNow] = useState<Date | null>(null);
  useLive(() => { setNow(new Date()); }, { everyMs: 1000, hiddenMs: 60_000 });

  const partsIn = (zone: string, d: Date) => {
    const p = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone, hour12: false, hour: "2-digit", minute: "2-digit", weekday: "short", day: "2-digit",
    }).formatToParts(d);
    const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
    return { h: Number(get("hour")) % 12, m: Number(get("minute")), day: `${get("weekday")} ${get("day")}`.toUpperCase(),
      hhmm: `${get("hour")}:${get("minute")}` };
  };

  return (
    <Pane n={n} title="World Clocks">
      <div className="clocks">
        {ZONES.map((z) => {
          const t = now ? partsIn(z.zone, now) : null;
          const hAng = t ? (t.h + t.m / 60) * 30 : 0;
          const mAng = t ? t.m * 6 : 0;
          return (
            <div className="clk" key={z.zone}>
              <svg viewBox="0 0 40 40" aria-hidden>
                <circle cx="20" cy="20" r="18" fill="none" stroke="var(--rule)" />
                {[0, 90, 180, 270].map((a) => (
                  <line key={a} x1="20" y1="3" x2="20" y2="6" stroke="var(--rule-strong)" transform={`rotate(${a} 20 20)`} />
                ))}
                <line x1="20" y1="20" x2="20" y2="11" stroke="var(--foreground)" strokeWidth="1.6" transform={`rotate(${hAng} 20 20)`} />
                <line x1="20" y1="20" x2="20" y2="7" stroke="var(--signal)" strokeWidth="1" transform={`rotate(${mAng} 20 20)`} />
                <circle cx="20" cy="20" r="1.2" fill="var(--foreground)" />
              </svg>
              <span className="clk-t">{t?.hhmm ?? "--:--"}</span>
              <span className="clk-k">{z.label}</span>
              <span className="clk-d">{t?.day ?? ""}</span>
            </div>
          );
        })}
      </div>
    </Pane>
  );
}

/* ── 16 SKY ───────────────────────────────────────────────────────────────
   Moon phase drawn from the illuminated fraction the sky endpoint already
   computes, plus sunrise and sunset. */
export function SkyTile({ n }: { n?: number }) {
  const [sky, setSky] = useState<{
    moon: { phase: number; illum: number; name: string };
    sun?: { sunrise: string; sunset: string };
    iss?: { alt: number; vel: number };
  } | null>(null);

  useLive(() => fetch("/api/sky").then((r) => r.json()).then((j) => setSky(j?.data ?? null)).catch(() => {}), { everyMs: 900_000 });

  const clock = (iso?: string) => (iso
    ? new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso))
    : "—");

  // Waxing on the first half of the cycle, so the lit limb is on the right.
  const illum = sky?.moon.illum ?? 0;
  const waxing = (sky?.moon.phase ?? 0) < 0.5;

  return (
    <Pane n={n} title="Sky" status={sky ? "LIVE" : "…"} live={!!sky}>
      <div className="moonrow">
        <svg className="moon" viewBox="0 0 40 40" aria-hidden>
          <circle cx="20" cy="20" r="16" fill="var(--hairbg)" />
          <path
            d={`M20 4 A16 16 0 0 ${waxing ? 1 : 0} 20 36 A${16 * Math.abs(1 - 2 * illum)} 16 0 0 ${
              (illum > 0.5) === waxing ? 1 : 0} 20 4 Z`}
            fill="var(--foreground)"
          />
          <circle cx="20" cy="20" r="16" fill="none" stroke="var(--rule)" />
        </svg>
        <div>
          <div className="moon-n">{sky?.moon.name ?? "—"}</div>
          <div className="moon-i">{sky ? `${Math.round(illum * 100)}% ILLUMINATED` : ""}</div>
        </div>
      </div>
      <Row k="Sunrise" v={`${clock(sky?.sun?.sunrise)} IST`} />
      <Row k="Sunset" v={`${clock(sky?.sun?.sunset)} IST`} />
      {sky?.iss && <Row k="ISS alt" v={`${Math.round(sky.iss.alt)} KM · ${Math.round(sky.iss.vel).toLocaleString("en-IN")} KM/H`} tone="muted" />}
    </Pane>
  );
}

/* ── 22 COMMAND REFERENCE ─────────────────────────────────────────────────
   What you can type. Every line here is a command that exists — a reference
   that lists things which do not work is worse than no reference. */
const COMMANDS: [string, string][] = [
  ["ask <q>", "Query Sage knowledge"],
  ["note <text>", "Capture a note"],
  ["task <title>", "Create new task"],
  ["status", "System status"],
  ["anything else", "Open AI mode"],
];

export function CommandsTile({ n }: { n?: number }) {
  return (
    <Pane n={n} title="Command Reference">
      {COMMANDS.map(([c, d]) => (
        <div className="cref" key={c}>
          <span className="cref-c">→ {c}</span>
          <span className="cref-d">{d}</span>
        </div>
      ))}
    </Pane>
  );
}

export { BarStrip };
