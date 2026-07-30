import { listApplications, STAGES, type Application, type Stage } from "./scan";

/**
 * Pipeline analytics.
 *
 * Applications were being tracked but never measured, so the questions that
 * actually matter — how many of these convert, and which ones have gone quiet
 * — had no answer short of counting cards by eye.
 */

/** Untouched for this long and it needs a nudge, not a card. */
export const STALE_DAYS = 21;
/** A deadline this close is worth surfacing. */
export const DEADLINE_SOON_DAYS = 3;

/** Stages an application can still progress from. */
const OPEN_STAGES: Stage[] = ["applied", "assessment", "interview"];

export interface AppInsight {
  id: string;
  company: string;
  role: string;
  stage: Stage;
  /** Days since the application entered its current stage. */
  daysInStage: number;
  /** Open, and untouched for longer than STALE_DAYS. */
  stale: boolean;
  /** Days until the deadline; negative when already passed, null when unset. */
  daysToDeadline: number | null;
}

export interface Funnel {
  counts: Record<Stage, number>;
  total: number;
  /** Reached interview or beyond, as a share of everything applied. */
  interviewRate: number;
  /** Offers as a share of everything applied. */
  offerRate: number;
  /** Median days from first record to reaching interview; null if never. */
  medianDaysToInterview: number | null;
}

const DAY = 86_400_000;
const days = (from: string, to = Date.now()) => Math.floor((to - new Date(from).getTime()) / DAY);

/** When the application entered the stage it is in now. */
function enteredCurrentStage(a: Application): string {
  const history = a.history ?? [];
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].stage === a.stage) return history[i].at;
  }
  // No trail (an application created before history was recorded) — updatedAt
  // is the best available proxy, and never worse than nothing.
  return a.updatedAt;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function analyse(apps: Application[]): { funnel: Funnel; insights: AppInsight[] } {
  const counts = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
  for (const a of apps) counts[a.stage] = (counts[a.stage] ?? 0) + 1;

  const total = apps.length;
  // "Reached" rather than "is in": an offer obviously cleared the interview
  // stage, and counting only current stage would understate both rates.
  const reached = (target: Stage[]) =>
    apps.filter((a) => target.includes(a.stage) || (a.history ?? []).some((h) => target.includes(h.stage))).length;

  const interviewed = reached(["interview", "offer"]);
  const offered = reached(["offer"]);

  const toInterview: number[] = [];
  for (const a of apps) {
    const history = a.history ?? [];
    const start = history[0]?.at;
    const hit = history.find((h) => h.stage === "interview" || h.stage === "offer");
    if (start && hit) toInterview.push(Math.max(0, days(start, new Date(hit.at).getTime())));
  }

  const insights: AppInsight[] = apps.map((a) => {
    const daysInStage = Math.max(0, days(enteredCurrentStage(a)));
    return {
      id: a.id,
      company: a.company,
      role: a.role,
      stage: a.stage,
      daysInStage,
      stale: OPEN_STAGES.includes(a.stage) && daysInStage >= STALE_DAYS,
      daysToDeadline: a.deadline ? -days(a.deadline) : null,
    };
  });

  return {
    funnel: {
      counts,
      total,
      interviewRate: total ? interviewed / total : 0,
      offerRate: total ? offered / total : 0,
      medianDaysToInterview: median(toInterview),
    },
    insights,
  };
}

export async function pipelineReport() {
  return analyse(await listApplications());
}

/** Applications needing attention now: a deadline inside the window, or gone
 *  quiet. Used by the cron nudge and by the page's attention strip. */
export function needsAttention(insights: AppInsight[]) {
  const dueSoon = insights.filter(
    (i) => i.daysToDeadline !== null && i.daysToDeadline >= 0 && i.daysToDeadline <= DEADLINE_SOON_DAYS,
  );
  const stale = insights.filter((i) => i.stale);
  return { dueSoon, stale };
}
