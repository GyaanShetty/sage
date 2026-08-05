import type { Decision, Domain, Outcome } from "./store";

/**
 * Was he as right as he thought he was?
 *
 * Confidence is a claim about frequency: "80% sure" asserts that in the long
 * run, four out of five such calls come off. That claim is checkable, and
 * almost nobody checks it. Checking it is the only way to find out whether
 * being sure means anything when he is the one who is sure.
 *
 * Two failure modes this is built to expose:
 *
 *   - Overconfidence, which is the common one: 90% claims landing 60% of the
 *     time. Cheap to fix once seen, invisible until measured.
 *   - Underconfidence in his own good calls, which reads as hesitation and
 *     costs just as much in a field where conviction is the product.
 *
 * Deliberately no model anywhere near this file. Scoring is arithmetic on his
 * own judgements, and an LLM guessing at outcomes would corrupt the one number
 * here that is actually evidence.
 */

/** Confidence bands. Wide, because the sample will never be large. */
export const BANDS = [
  { from: 50, to: 60, label: "50-59%" },
  { from: 60, to: 70, label: "60-69%" },
  { from: 70, to: 80, label: "70-79%" },
  { from: 80, to: 90, label: "80-89%" },
  { from: 90, to: 100, label: "90-99%" },
] as const;

export interface Band {
  label: string;
  from: number;
  to: number;
  /** Scored decisions in this band. */
  n: number;
  /** How often he said he'd be right, averaged. */
  claimed: number;
  /** How often he actually was. */
  actual: number;
  /** actual − claimed. Negative is overconfident. */
  gap: number;
}

export interface Calibration {
  scored: number;
  pending: number;
  /** Overall hit rate across everything scored. */
  hitRate: number;
  /** Mean confidence claimed across everything scored. */
  meanConfidence: number;
  /** Positive = underconfident, negative = overconfident. */
  overconfidence: number;
  /**
   * Brier score: mean squared error between claim and outcome. 0 is perfect,
   * 0.25 is a coin flip. Unlike a hit rate it punishes being confidently wrong
   * more than being hesitantly wrong, which is the distinction that matters.
   */
  brier: number | null;
  bands: Band[];
  byDomain: { domain: Domain; n: number; hitRate: number; overconfidence: number }[];
  notes: string[];
}

/**
 * How an outcome counts.
 *
 * "Mixed" is a half — a real answer for a call that was partly right, and one
 * that cannot be gamed into looking like a win. "Too early" is not scored at
 * all: an unresolved question is not a wrong answer, and counting it as one
 * would punish him for choosing a review date that came round too soon.
 */
export function outcomeValue(outcome: Outcome | null | undefined): number | null {
  if (outcome === "right") return 1;
  if (outcome === "wrong") return 0;
  if (outcome === "mixed") return 0.5;
  return null;
}

export function calibrate(decisions: Decision[]): Calibration {
  const scored = decisions
    .map((d) => ({ d, v: outcomeValue(d.outcome) }))
    .filter((x): x is { d: Decision; v: number } => x.v !== null);

  const pending = decisions.filter((d) => !d.outcome).length;

  if (scored.length === 0) {
    return {
      scored: 0, pending, hitRate: 0, meanConfidence: 0, overconfidence: 0, brier: null,
      bands: BANDS.map((b) => ({ ...b, n: 0, claimed: 0, actual: 0, gap: 0 })),
      byDomain: [],
      notes: [
        pending > 0
          ? `${pending} decision${pending === 1 ? "" : "s"} waiting on a review date. Nothing to score yet.`
          : "No decisions recorded yet. The point is to write down what you expect before you find out.",
      ],
    };
  }

  const hitRate = scored.reduce((a, x) => a + x.v, 0) / scored.length;
  const meanConfidence = scored.reduce((a, x) => a + x.d.confidence, 0) / scored.length / 100;
  const brier = scored.reduce((a, x) => a + (x.d.confidence / 100 - x.v) ** 2, 0) / scored.length;

  const bands: Band[] = BANDS.map((b) => {
    const inBand = scored.filter((x) => x.d.confidence >= b.from && x.d.confidence < b.to);
    const claimed = inBand.length ? inBand.reduce((a, x) => a + x.d.confidence, 0) / inBand.length / 100 : 0;
    const actual = inBand.length ? inBand.reduce((a, x) => a + x.v, 0) / inBand.length : 0;
    return { ...b, n: inBand.length, claimed, actual, gap: inBand.length ? actual - claimed : 0 };
  });

  const domains = [...new Set(scored.map((x) => x.d.domain))];
  const byDomain = domains
    .map((domain) => {
      const own = scored.filter((x) => x.d.domain === domain);
      const rate = own.reduce((a, x) => a + x.v, 0) / own.length;
      const claim = own.reduce((a, x) => a + x.d.confidence, 0) / own.length / 100;
      return { domain, n: own.length, hitRate: rate, overconfidence: rate - claim };
    })
    .sort((a, b) => b.n - a.n);

  const overconfidence = hitRate - meanConfidence;
  const notes: string[] = [];

  // Below this, differences are noise and saying otherwise would be the same
  // overclaiming the journal exists to catch.
  const THIN = 10;
  if (scored.length < THIN) {
    notes.push(`Only ${scored.length} scored so far — read this as a sketch, not a verdict. It takes a few dozen before the numbers mean much.`);
  } else if (overconfidence < -0.1) {
    notes.push(`You are overconfident by about ${Math.round(Math.abs(overconfidence) * 100)} points: your calls land ${Math.round(hitRate * 100)}% of the time and you claim ${Math.round(meanConfidence * 100)}%. Shading your numbers down would make them mean something.`);
  } else if (overconfidence > 0.1) {
    notes.push(`You are underconfident by about ${Math.round(overconfidence * 100)} points — right ${Math.round(hitRate * 100)}% of the time while claiming ${Math.round(meanConfidence * 100)}%. You are hedging calls you are actually getting right.`);
  } else {
    notes.push(`Well calibrated: ${Math.round(hitRate * 100)}% right against ${Math.round(meanConfidence * 100)}% claimed. Your confidence is worth trusting.`);
  }

  const worst = byDomain.filter((d) => d.n >= 5).sort((a, b) => a.overconfidence - b.overconfidence)[0];
  if (worst && worst.overconfidence < -0.15) {
    notes.push(`${worst.domain} is where the gap is widest — ${Math.round(worst.hitRate * 100)}% right across ${worst.n} calls.`);
  }

  if (pending > 0) notes.push(`${pending} still waiting on a review date.`);

  return { scored: scored.length, pending, hitRate, meanConfidence, overconfidence, brier, bands, byDomain, notes };
}
