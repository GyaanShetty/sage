"use client";

/**
 * Am I moving.
 *
 * GitHub and LeetCode in one module, because they are the same question
 * asked of two sites: did I ship today, and have I kept shipping. Two
 * separate panels would have made you check two places for one answer.
 *
 * Both halves lead with the STREAK rather than the total. A lifetime
 * count of 1,247 solved is a fact about the past that cannot be changed
 * today; a streak of 6 is a thing you can still protect before midnight,
 * which is the only number on this panel you can act on.
 *
 * On colour: the contribution grid is a magnitude, so it is drawn on the
 * grey sequential ramp, light to dark. GitHub's own green is tempting and
 * wrong here — the budget spends green on market direction, and one hue
 * meaning two things is how a palette stops meaning anything. The accent
 * appears on exactly one condition: a live streak with nothing logged
 * today, which is the one state on this panel that is about to go wrong.
 */

import { useCallback, useMemo, useState } from "react";
import { Pane } from "@/components/pane";
import { useLive } from "@/lib/live";

interface ContribDay { date: string; count: number; level: number }
interface Contributions { total: number; weeks: ContribDay[][]; max: number }
interface LeetStats {
  username: string;
  ranking: number | null;
  solved: { all: number; easy: number; medium: number; hard: number };
  streak: number;
  totalActiveDays: number;
  todaySolved: number;
  calendar: Record<string, number>;
}
interface Daily { date: string; link: string; title: string; titleSlug: string; difficulty: string }

/* GitHub's own 0–4 banding, on the grey sequential ramp. Level 0 is a
   drawn cell rather than a gap: an empty day is data. */
const LEVEL = ["var(--sunken)", "var(--q5)", "var(--q4)", "var(--q2)", "var(--q1)"];

const iso = (d: Date) =>
  `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;

/**
 * Consecutive days ending today (or yesterday) with at least one
 * contribution.
 *
 * Counted from yesterday when today is still empty, so an untouched
 * morning does not report the streak as already broken — it is not broken
 * until the day ends, and saying otherwise at 9am is both wrong and
 * demoralising.
 */
function streakOf(weeks: ContribDay[][]): { days: number; todayDone: boolean } {
  const days = weeks.flat().sort((a, b) => a.date.localeCompare(b.date));
  const today = iso(new Date());
  const todayDone = (days.find((d) => d.date === today)?.count ?? 0) > 0;
  let n = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i];
    if (d.date > today) continue;
    if (d.date === today && !todayDone) continue; // today is not over yet
    if (d.count > 0) n++;
    else break;
  }
  return { days: n, todayDone };
}

export function ProgressPanel({ n }: { n?: number }) {
  const [gh, setGh] = useState<Contributions | null | "none">(null);
  const [leet, setLeet] = useState<LeetStats | null>(null);
  const [daily, setDaily] = useState<Daily | null>(null);

  const load = useCallback(() => Promise.all([
    fetch("/api/github/contributions")
      .then((r) => r.json())
      .then((j) => setGh(j.data ?? "none"))
      .catch(() => setGh("none")),
    fetch("/api/leetcode")
      .then((r) => r.json())
      .then((j) => { setLeet(j.data?.stats ?? null); setDaily(j.data?.daily ?? null); })
      .catch(() => { /* leave the last good reading on screen */ }),
  ]), []);

  useLive(load, { everyMs: 600_000 });

  const weeks = gh && gh !== "none" ? gh.weeks : [];
  /* The last fourteen weeks, not the year. A 53-week calendar in a 240px
     rail is 53 columns of two pixels — a texture, not a reading. */
  const recent = weeks.slice(-14);
  const streak = weeks.length ? streakOf(weeks) : null;
  const atRisk = streak !== null && streak.days > 0 && !streak.todayDone;

  /*
   * Thirty days of LeetCode submissions.
   *
   * The E/M/H bars are a lifetime total and barely move; the streak is a
   * single number. Neither shows the SHAPE — a fortnight off followed by
   * a hard week, which is the thing you actually want to see about your
   * own consistency. The calendar comes back from the API keyed by day,
   * so this is a free reading of data already on the wire.
   */
  const subs = useMemo(() => {
    const cal = leet?.calendar ?? {};
    const out: { day: string; n: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const k = iso(d);
      out.push({ day: k, n: cal[k] ?? 0 });
    }
    return out;
  }, [leet]);
  const subPeak = Math.max(1, ...subs.map((s) => s.n));

  const solved = leet?.solved;
  const tiers: [string, number, string][] = solved
    ? [["E", solved.easy, "var(--q1)"], ["M", solved.medium, "var(--q3)"], ["H", solved.hard, "var(--q5)"]]
    : [];
  const maxTier = solved ? Math.max(solved.easy, solved.medium, solved.hard, 1) : 1;

  return (
    <Pane
      n={n}
      title="Progress"
      status={atRisk ? "NOTHING TODAY" : streak ? `${streak.days}D STREAK` : "—"}
      live={atRisk}
    >
      <div className="pg">

        {/* ── github ─────────────────────────────────────────────── */}
        <div className="pg-head">
          <span className="pg-k">GitHub</span>
          {gh === "none" && <span className="pg-quiet">no token</span>}
          {gh && gh !== "none" && (
            <>
              <span className={`pg-big num${atRisk ? " risk" : ""}`}>{streak?.days ?? 0}</span>
              <span className="pg-unit">day{streak?.days === 1 ? "" : "s"}</span>
              <span className="pg-right num">{gh.total.toLocaleString()} <i>yr</i></span>
            </>
          )}
        </div>

        {gh && gh !== "none" && (
          <div className="pg-grid" role="img" aria-label={`${gh.total} contributions in the last year`}>
            {recent.map((week, wi) => (
              <div className="pg-col" key={wi}>
                {week.map((d) => (
                  <i
                    className="pg-cell"
                    key={d.date}
                    style={{ background: LEVEL[Math.min(d.level, 4)] }}
                    title={`${d.date} · ${d.count} contribution${d.count === 1 ? "" : "s"}`}
                  />
                ))}
              </div>
            ))}
          </div>
        )}

        {/* ── leetcode ───────────────────────────────────────────── */}
        <div className="pg-head pg-sep">
          <span className="pg-k">LeetCode</span>
          {!leet && <span className="pg-quiet">no profile</span>}
          {leet && (
            <>
              <span className="pg-big num">{leet.solved.all}</span>
              <span className="pg-unit">solved</span>
              {leet.ranking != null && <span className="pg-right num">#{leet.ranking.toLocaleString()}</span>}
            </>
          )}
        </div>

        {leet && (
          <div className="pg-subs" role="img"
               aria-label={`LeetCode submissions over 30 days, peak ${subPeak} in a day`}>
            {subs.map((s) => (
              <span className={s.n ? "on" : undefined} key={s.day}
                    title={`${s.day} · ${s.n} submission${s.n === 1 ? "" : "s"}`}>
                <i style={{ height: `${s.n ? Math.max(14, (s.n / subPeak) * 100) : 1}%` }} />
              </span>
            ))}
          </div>
        )}

        {solved && (
          <div className="pg-tiers">
            {tiers.map(([k, v, tone]) => (
              <div className="pg-tier" key={k}>
                <span className="pg-tier-k">{k}</span>
                <span className="pg-tier-bar">
                  <i style={{ width: `${(v / maxTier) * 100}%`, background: tone }} />
                </span>
                <span className="pg-tier-n num">{v}</span>
              </div>
            ))}
          </div>
        )}

        {daily && (
          /* The daily challenge is the one actionable row on the panel, so
             it is a link and everything above it is a readout. */
          <a className="pg-daily" href={daily.link} target="_blank" rel="noopener noreferrer">
            <span className="pg-daily-k">Daily</span>
            <span className="pg-daily-t">{daily.title}</span>
            <span className={`pg-diff d-${daily.difficulty.toLowerCase()}`}>{daily.difficulty.slice(0, 1)}</span>
          </a>
        )}
      </div>
    </Pane>
  );
}
