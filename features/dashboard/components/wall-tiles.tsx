"use client";

import { useState } from "react";
import Link from "next/link";
import { Pane, Row, Stat, Empty } from "@/components/pane";
import { PaneForm } from "@/components/pane-form";
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
interface Quote { symbol: string; name?: string; price: number; changePct?: number; currency?: string }
interface Fx { pair: string; rate: number; changePct?: number }

/**
 * A missing percentage renders as an em dash, not as NaN.
 *
 * /api/stocks does not always carry changePct, and `Math.abs(undefined)` is
 * NaN — which is how "RELIANCE ₹1,284 ▽NaN%" got onto the screen. A gauge that
 * prints NaN is worse than one that prints nothing: it looks like a reading.
 */
const pct = (v?: number) =>
  Number.isFinite(v) ? `${v! >= 0 ? "▲" : "▽"}${Math.abs(v!).toFixed(1)}%` : "—";
const pctClass = (v?: number) => (Number.isFinite(v) ? (v! >= 0 ? "up" : "down") : "");

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
              v={<>{money(s.price, s.currency === "INR" ? "₹" : "$")} <b className={pctClass(s.changePct)}>{pct(s.changePct)}</b></>}
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
interface HealthDay {
  day: string; restingHr?: number; spo2?: number; sleepHours?: number;
  activeKcal?: number; steps?: number; dietaryKcal?: number; waterMl?: number;
}

export function HealthTile({ n }: { n?: number }) {
  const [series, setSeries] = useState<HealthDay[] | null>(null);

  useLive(
    () => fetch("/api/health").then((r) => r.json())
      .then((j) => setSeries(asArray<HealthDay>(j?.data?.series))).catch(() => setSeries([])),
    { everyMs: 900_000 },
  );

  /**
   * A metric that was never sent is missing, not zero.
   *
   * This coerced absent fields to 0, so a shortcut that posts sleep and
   * nothing else rendered "0 BPM" and "0 KCAL" — which is not an empty
   * reading, it is a claim that his resting heart rate is zero. Absent values
   * are dropped, and a trace with nothing in it says so.
   */
  const col = (k: keyof HealthDay) =>
    (series ?? [])
      .map((d) => d[k])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

  const trace = (label: string, k: keyof HealthDay, unit: string, tone: string) => {
    const data = col(k);
    const last = data.length ? data[data.length - 1] : null;
    return (
      <div className="hz" key={label}>
        <div className="hz-h">
          <span className="hz-k">{label}</span>
          <span className={`hz-v${last == null ? " none" : ""}`}>
            {last != null ? `${Math.round(last)}${unit}` : "NOT SENT"}
          </span>
        </div>
        {data.length > 1 && <Wave data={data} height={22} tone={tone} />}
      </div>
    );
  };

  return (
    <Pane n={n} title="Health" status={<Go href="/health">{series?.length ? "LIVE" : "…"}</Go>} live={!!series?.length}>
      {series?.length === 0 && <Empty reason="No health data" action="Run the Health shortcut" href="/health" />}
      {trace("Heart rate", "restingHr", " BPM", "var(--live)")}
      {trace("Blood oxygen", "spo2", "%", "var(--signal)")}
      {trace("Sleep", "sleepHours", " H", "var(--muted)")}
      {trace("Energy out", "activeKcal", " KCAL", "var(--live)")}
      {/* In and out are separate traces on purpose. Netting one against the
          other produces a number that is neither, and hides the day you ate
          nothing and the day you trained twice behind the same zero. */}
      {trace("Energy in", "dietaryKcal", " KCAL", "var(--signal)")}
      {trace("Water", "waterMl", " ML", "var(--muted)")}
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
      {rows.length === 0 && <Empty reason="Nothing logged this week" action="Open the log" href="/sitrep" />}
      {/* An empty histogram is not a small histogram — it is an empty box with
          a minimum height, holding space it has nothing to put in. */}
      {rows.length > 0 && <div className="acts">
        {rows.map((d) => (
          <div className="act" key={d.day}>
            <span className="act-n">{d.count}</span>
            <span className="act-b" style={{ height: `${(d.count / peak) * 100}%` }} />
            <span className="act-k">{label(d.day)}</span>
          </div>
        ))}
      </div>}
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
  const [url, setUrl] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const load = () => fetch("/api/youtube").then((r) => r.json())
    .then((j) => setItems(asArray<Video>(j?.data?.videos))).catch(() => setItems([]));

  useLive(load, { everyMs: 900_000, scopes: ["feeds"] });

  /**
   * Adding lives in the magnified view only.
   *
   * A text field in a pane this size is not usable — it would be forty pixels
   * wide next to four thumbnails — and the add is a rare action while reading
   * the list is the constant one. The pane stays a list; ⤢ is where you go to
   * change what feeds it.
   */
  const add = async () => {
    const paste = url.trim();
    if (!paste) return;
    setNote("…");
    const j = await fetch("/api/feeds/sources", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: paste }),
    }).then((r) => r.json()).catch(() => null);

    if (j?.ok) {
      setUrl("");
      setNote("Added. Fetching…");
      // The upstream is cached for half an hour, so the new channel will not
      // appear this second. Saying so beats a list that looks unchanged.
      void load();
    } else {
      setNote(j?.error ?? "Couldn't add that.");
    }
  };

  return (
    <Pane n={n} title="Feeds" status={<Go href="/wire">See all</Go>}>
      <div className="feed-add">
        <input
          value={url}
          onChange={(e) => { setUrl(e.target.value); setNote(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
          placeholder="PASTE A YOUTUBE CHANNEL OR VIDEO LINK"
        />
        <button onClick={() => void add()}>ADD</button>
        {note && <span className="feed-note">{note}</span>}
      </div>
      {!items && <div className="tile-wait">ACQUIRING…</div>}
      {items?.length === 0 && <Empty reason="No videos in the watchlist" action="Add channels" href="/settings" />}
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

/* ── 24 CODE ──────────────────────────────────────────────────────────────
   The daily LeetCode problem and where he stands.

   Functional rather than decorative: the title is a link straight into the
   problem, and the split by difficulty is the number that actually tells you
   whether the practice is going anywhere — "1,284 solved" does not. */
interface LeetDaily { date: string; link: string; title: string; difficulty: string }
interface LeetStats {
  username: string; ranking: number | null;
  solved: { all: number; easy: number; medium: number; hard: number };
  streak: number; todaySolved: number;
}

export function CodeTile({ n }: { n?: number }) {
  const [d, setD] = useState<{ daily: LeetDaily | null; stats: LeetStats | null } | null>(null);

  useLive(
    () => fetch("/api/leetcode").then((r) => r.json()).then((j) => setD(j?.data ?? null)).catch(() => setD(null)),
    { everyMs: 1_800_000 },
  );

  const s = d?.stats;
  const solvedToday = (s?.todaySolved ?? 0) > 0;

  return (
    <Pane
      n={n}
      title="Code"
      status={<Go href="/code">{s ? `${s.streak}D STREAK` : "LEETCODE"}</Go>}
      live={solvedToday}
    >
      {!d && <div className="tile-wait">ACQUIRING…</div>}
      {d?.daily && (
        <a className="cd-daily" href={d.daily.link} target="_blank" rel="noreferrer">
          <span className="tile-cap">DAILY · {d.daily.difficulty.toUpperCase()}</span>
          <span className="cd-t">{d.daily.title}</span>
        </a>
      )}
      {s && (
        <>
          <Row k="Solved" v={String(s.solved.all)} tone="signal" />
          <Row k="Easy / Med / Hard" v={`${s.solved.easy} · ${s.solved.medium} · ${s.solved.hard}`} />
          {s.ranking != null && <Row k="Rank" v={s.ranking.toLocaleString("en-IN")} tone="muted" />}
          <Row k="Today" v={solvedToday ? `${s.todaySolved} DONE` : "NOT YET"} tone={solvedToday ? "up" : "down"} />
        </>
      )}
      {d && !s && <Empty reason="No LeetCode profile" action="Set your username" href="/settings" />}
    </Pane>
  );
}

/* ── 25 PUSH ──────────────────────────────────────────────────────────────
   What went to GitHub, and where it landed.

   Each row links to the file on GitHub. A push log you cannot click is a
   diary; one you can is a way back into the work. */
interface PushRecord { repo: string; path: string; url: string; language: string; title: string; at: string }

export function PushTile({ n }: { n?: number }) {
  const [d, setD] = useState<{ pushes: PushRecord[]; prefs: { repo: string; folder: string; language: string } | null; login: string | null } | null>(null);

  useLive(
    () => fetch("/api/push").then((r) => r.json()).then((j) => setD(j?.data ?? null)).catch(() => setD(null)),
    { everyMs: 300_000 },
  );

  const pushes = asArray<PushRecord>(d?.pushes);
  const when = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "2-digit", month: "short" }).format(new Date(iso)).toUpperCase();

  return (
    <Pane
      n={n}
      title="Push"
      status={<Go href="/push">{d?.prefs?.repo ?? (d?.login ? "NO REPO SET" : "GITHUB")}</Go>}
      live={pushes.length > 0}
    >
      {!d && <div className="tile-wait">ACQUIRING…</div>}
      {d && pushes.length === 0 && <Empty reason="Nothing pushed yet" action="Push a solution" href="/push" />}
      {pushes.slice(0, 6).map((p, i) => (
        <a className="psh" key={i} href={p.url} target="_blank" rel="noreferrer">
          <span className="psh-t">{p.title || p.path}</span>
          <span className="psh-m">{p.language.toUpperCase()} · {when(p.at)}</span>
        </a>
      ))}
    </Pane>
  );
}

/* ── 26 CAREER ────────────────────────────────────────────────────────────
   Applications by stage. The count per stage is the whole point: five
   applications sitting in "applied" and none in "interview" is a different
   situation from the reverse, and a flat total hides that. */
/**
 * `stage`, not `status`.
 *
 * The type in core/career/scan.ts has always called this `stage`, and this
 * tile read `status` — so every application fell through to the "applied"
 * bucket and the other three counts have been permanently zero since the pane
 * shipped. A pane that renders four numbers of which three cannot ever be
 * non-zero is worse than one that renders none: it looks like the data.
 *
 * The stage list is the same one the API validates against, so a stage added
 * there cannot silently vanish from here.
 */
interface Application { id: string; company: string; role?: string; stage?: string; deadline?: string | null }

const STAGES = ["applied", "assessment", "interview", "offer"] as const;

export function CareerTile({ n }: { n?: number }) {
  const [apps, setApps] = useState<Application[] | null>(null);

  useLive(
    () => fetch("/api/career").then((r) => r.json())
      .then((j) => setApps(asArray<Application>(j?.data))).catch(() => setApps([])),
    { everyMs: 600_000, scopes: ["career"] },
  );

  const rows = apps ?? [];
  const byStage = STAGES.map((st) => ({
    stage: st,
    count: rows.filter((a) => (a.stage ?? "applied").toLowerCase() === st).length,
  }));

  // Only deadlines still ahead — a passed deadline is history, not a warning.
  const next = rows
    .filter((a) => a.deadline && Date.parse(a.deadline) > Date.now())
    .sort((a, b) => Date.parse(a.deadline!) - Date.parse(b.deadline!))[0];

  return (
    <Pane
      n={n}
      title="Career"
      status={<Go href="/career">{rows.length ? `${rows.length} OPEN` : "—"}</Go>}
      live={rows.length > 0}
      edit={
        <PaneForm
          endpoint="/api/career"
          submitLabel="TRACK"
          onDone={() => window.dispatchEvent(new CustomEvent("sage:refresh", { detail: "career" }))}
          fields={[
            { name: "company", label: "Company", required: true },
            { name: "role", label: "Role" },
            { name: "stage", label: "Stage", type: "select", fallback: "applied",
              options: STAGES.map((s) => ({ value: s, label: s.toUpperCase() })) },
            { name: "deadline", label: "Deadline", type: "date" },
          ]}
        />
      }
    >
      {!apps && <div className="tile-wait">ACQUIRING…</div>}
      {apps?.length === 0 && <Empty reason="No applications tracked" action="Add one" href="/career" />}
      {rows.length > 0 && (
        <>
          <div className="km" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            {byStage.map((b) => <Stat key={b.stage} v={pad(b.count)} k={b.stage} tone={b.count > 0 ? "signal" : undefined} />)}
          </div>
          {next && (
            <Row
              k={`${next.company} deadline`}
              v={new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "2-digit", month: "short" })
                .format(new Date(next.deadline!)).toUpperCase()}
              tone="down"
            />
          )}
        </>
      )}
    </Pane>
  );
}

/* ── 27 INBOX ─────────────────────────────────────────────────────────────
   Unread mail, sender first. Who it is from decides whether you open it; the
   subject only matters once you have decided. */
interface MailMsg { id: string; subject: string; from?: string; fromName?: string; unread?: boolean }

export function InboxTile({ n }: { n?: number }) {
  const [msgs, setMsgs] = useState<MailMsg[] | null>(null);

  useLive(
    () => fetch("/api/mail?box=unread").then((r) => r.json())
      .then((j) => setMsgs(asArray<MailMsg>(j?.data?.messages))).catch(() => setMsgs([])),
    { everyMs: 300_000 },
  );

  const rows = msgs ?? [];

  return (
    <Pane n={n} title="Inbox" status={<Go href="/mail">{rows.length ? `${rows.length} UNREAD` : "CLEAR"}</Go>} live={rows.length > 0}>
      {!msgs && <div className="tile-wait">ACQUIRING…</div>}
      {msgs?.length === 0 && <Empty reason="Inbox clear" action="Open mail" href="/mail" />}
      {rows.slice(0, 6).map((m) => (
        <div className="psh" key={m.id}>
          <span className="psh-t">{m.subject || "(no subject)"}</span>
          <span className="psh-m">{(m.fromName || m.from || "").toUpperCase()}</span>
        </div>
      ))}
    </Pane>
  );
}

/* ── 31 REVIEW ────────────────────────────────────────────────────────────
   Flashcards due today.

   Due count first and total second, because "12 due" is the number that
   decides whether you sit down; "340 cards" never has. The pane links into
   the review screen, which is where the work actually happens. */
export function ReviewTile({ n }: { n?: number }) {
  const [d, setD] = useState<{ cards: { id: string; front: string }[]; total: number } | null>(null);

  useLive(
    () => fetch("/api/review").then((r) => r.json())
      .then((j) => setD({ cards: asArray(j?.data?.cards), total: Number(j?.data?.total ?? 0) })).catch(() => setD(null)),
    { everyMs: 600_000 },
  );

  const due = d?.cards.length ?? 0;

  return (
    <Pane n={n} title="Review" status={<Go href="/review">{d ? `${d.total} CARDS` : "…"}</Go>} live={due > 0}>
      {!d && <div className="tile-wait">ACQUIRING…</div>}
      {d && (
        <>
          <div className="tstat">
            <span className={`tstat-v${due > 0 ? " signal" : ""}`}>{pad(due)}</span>
            <span className="tstat-k">DUE TODAY</span>
          </div>
          {due === 0 && <Empty reason="Nothing due today" action="Review anyway" href="/review" />}
          {d.cards.slice(0, 4).map((c) => (
            <div className="psh" key={c.id}><span className="psh-t">{c.front}</span></div>
          ))}
        </>
      )}
    </Pane>
  );
}

/* ── 32 GRAPH ─────────────────────────────────────────────────────────────
   How much SAGE actually holds, and how connected it is.

   Nodes alone say how much went in; edges say whether any of it is joined to
   anything else. A store of ten thousand disconnected facts is a pile, and
   the ratio is what tells the two apart. */
interface GNode { id: string; kind: string }

export function GraphTile({ n }: { n?: number }) {
  const [g, setG] = useState<{ nodes: GNode[]; edges: unknown[] } | null>(null);

  useLive(
    () => fetch("/api/graph").then((r) => r.json())
      .then((j) => setG({ nodes: asArray<GNode>(j?.data?.nodes), edges: asArray(j?.data?.edges) })).catch(() => setG(null)),
    { everyMs: 900_000, scopes: ["memory"] },
  );

  const kinds = ["memory", "note", "source"];
  const counts = kinds.map((k) => (g?.nodes ?? []).filter((x) => x.kind === k).length);
  const links = g?.edges.length ?? 0;
  // Average edges per node — one decimal, because the difference between 0.4
  // and 1.2 is the whole signal and rounding to integers erases it.
  const density = g && g.nodes.length ? (links / g.nodes.length).toFixed(1) : "—";

  return (
    <Pane n={n} title="Graph" status={<Go href="/graph">{g ? `${g.nodes.length} NODES` : "…"}</Go>} live={!!g?.nodes.length}>
      {!g && <div className="tile-wait">ACQUIRING…</div>}
      {g?.nodes.length === 0 && <Empty reason="Graph is empty" action="Add a source" href="/knowledge" />}
      {!!g?.nodes.length && (
        <>
          <div className="km">
            {kinds.map((k, i) => <Stat key={k} v={pad(counts[i])} k={k} />)}
          </div>
          <Row k="Links" v={String(links)} tone="signal" />
          <Row k="Links per node" v={density} tone="muted" />
        </>
      )}
    </Pane>
  );
}

/* ── 33 SPEND ─────────────────────────────────────────────────────────────
   Thirty days out, by category, largest first.

   The total is the least useful number here and goes last: you already know
   roughly what you spend. Where it went is the thing you cannot recall, and
   the recurring line is the one that quietly grows while nobody looks at it. */
interface Spend { total: number; byCategory: Record<string, number>; recurring: { merchant: string; amount: number }[] }

export function SpendTile({ n }: { n?: number }) {
  const [s, setS] = useState<Spend | null | undefined>(undefined);

  useLive(
    () => fetch("/api/expenses").then((r) => r.json())
      .then((j) => setS(j?.data?.summary ?? null)).catch(() => setS(null)),
    { everyMs: 600_000 },
  );

  const cats = Object.entries(s?.byCategory ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const rupees = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
  const subs = asArray<{ merchant: string; amount: number }>(s?.recurring);

  return (
    <Pane
      n={n}
      title="Spend"
      status={<Go href="/portfolio">30 DAYS</Go>}
      live={!!s?.total}
      edit={
        <PaneForm
          endpoint="/api/expenses"
          submitLabel="LOG"
          fields={[
            { name: "amount", label: "Amount ₹", type: "number", required: true },
            { name: "merchant", label: "Merchant", required: true },
            { name: "category", label: "Category", type: "select", fallback: "other",
              options: ["food", "transport", "bills", "subscriptions", "health", "other"]
                .map((c) => ({ value: c, label: c.toUpperCase() })) },
          ]}
        />
      }
    >
      {s === undefined && <div className="tile-wait">ACQUIRING…</div>}
      {(s === null || (s && !s.total)) && <Empty reason="Nothing logged" action="Add an expense" href="/portfolio" />}
      {!!s?.total && (
        <>
          <div className="tstat">
            <span className="tstat-v">{rupees(s.total)}</span>
            <span className="tstat-k">LAST 30 DAYS</span>
          </div>
          {cats.map(([cat, amt]) => (
            <Row key={cat} k={cat} v={rupees(amt)} />
          ))}
          {subs.length > 0 && (
            <Row k="Recurring" v={rupees(subs.reduce((a, x) => a + x.amount, 0))} tone="signal" />
          )}
        </>
      )}
    </Pane>
  );
}

/* ── 34 CALIBRATION ───────────────────────────────────────────────────────
   Whether his confidence is worth anything.

   Hit rate on its own flatters — call everything at 95% and get 90% right and
   you look excellent while being systematically overconfident. The gap
   between claimed confidence and actual outcome is the number that tells you
   something you did not already believe, so it leads. */
interface Calibration { scored: number; pending: number; hitRate: number; meanConfidence: number; overconfidence: number; brier: number | null }

export function CalibrationTile({ n }: { n?: number }) {
  const [c, setC] = useState<Calibration | null | undefined>(undefined);

  useLive(
    () => fetch("/api/decisions").then((r) => r.json())
      .then((j) => setC(j?.data?.calibration ?? null)).catch(() => setC(null)),
    { everyMs: 900_000 },
  );

  const asPct = (v: number) => `${Math.round(v * 100)}%`;
  const over = c ? c.overconfidence : 0;

  return (
    <Pane n={n} title="Calibration" status={<Go href="/decisions">{c ? `${c.scored} SCORED` : "…"}</Go>} live={!!c?.scored}>
      {c === undefined && <div className="tile-wait">ACQUIRING…</div>}
      {(c === null || c?.scored === 0) && (
        <Empty reason="No decisions resolved yet" action="Log a call" href="/decisions" />
      )}
      {!!c?.scored && (
        <>
          <div className="tstat">
            <span className={`tstat-v${Math.abs(over) > 0.1 ? " down" : " up"}`}>
              {over >= 0 ? "+" : "−"}{Math.abs(Math.round(over * 100))}
            </span>
            <span className="tstat-k">{over >= 0 ? "OVERCONFIDENT" : "UNDERCONFIDENT"}</span>
          </div>
          <Row k="Hit rate" v={asPct(c.hitRate)} />
          <Row k="Mean confidence" v={asPct(c.meanConfidence)} />
          {c.brier != null && <Row k="Brier" v={c.brier.toFixed(3)} tone="muted" />}
          <Row k="Awaiting outcome" v={String(c.pending)} tone={c.pending > 0 ? "signal" : "muted"} />
        </>
      )}
    </Pane>
  );
}

/* ── 29 GROWTH ────────────────────────────────────────────────────────────
   What SAGE learned, week by week.

   `32 GRAPH` says how much is held right now, which is a stock. This is the
   flow: memories committed per week over the last three months. A store that
   grew fast and then stopped tells you something a single total never can,
   and it is the difference between a system in use and one that was set up
   once. */
export function GrowthTile({ n }: { n?: number }) {
  const [weeks, setWeeks] = useState<{ week: string; count: number }[] | null>(null);

  useLive(
    () => fetch("/api/events/weekly?type=memory.extracted").then((r) => r.json())
      .then((j) => setWeeks(asArray<{ week: string; count: number }>(j?.data))).catch(() => setWeeks([])),
    { everyMs: 900_000, scopes: ["memory"] },
  );

  const rows = weeks ?? [];
  const total = rows.reduce((a, w) => a + w.count, 0);
  const last = rows.length ? rows[rows.length - 1].count : 0;
  const prev = rows.length > 1 ? rows[rows.length - 2].count : 0;

  return (
    <Pane
      n={n}
      title="Growth"
      status={<Go href="/memory">12 WEEKS</Go>}
      live={last > 0}
      edit={
        <PaneForm
          endpoint="/api/memory"
          submitLabel="REMEMBER"
          fields={[{ name: "text", label: "Tell Sage something worth keeping", required: true }]}
        />
      }
    >
      {!weeks && <div className="tile-wait">ACQUIRING…</div>}
      {weeks?.length === 0 && <Empty reason="Nothing committed yet" action="Tell Sage something" href="/memory" />}
      {rows.length > 0 && (
        <>
          <div className="tstat">
            <span className="tstat-v">{total}</span>
            <span className="tstat-k">COMMITTED · 12 WEEKS</span>
          </div>
          <BarStrip data={rows.map((w) => w.count)} height={34} />
          <Row k="This week" v={String(last)} tone={last >= prev ? "up" : "down"} />
          <Row k="Last week" v={String(prev)} tone="muted" />
        </>
      )}
    </Pane>
  );
}
