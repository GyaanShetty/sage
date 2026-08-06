"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Timer, ArrowRight } from "lucide-react";

/**
 * The one place exam mode reaches outside its own page.
 *
 * The exam page promised the app would change when a paper is close, and until
 * now the only thing that actually changed was what the night shift did at 3am
 * — which he would never see unless he went looking. This is the seeing part: a
 * strip above everything else on the dashboard, with the number of days and how
 * many questions are waiting.
 *
 * It renders nothing at all outside exam mode. A countdown that is always
 * present is furniture, and furniture is ignored.
 */

interface Countdown {
  exam: { id: string; subject: string; at: string };
  days: number;
  phase: string;
  headline: string;
  focus: string;
}

export function ExamStrip() {
  const [data, setData] = useState<{ countdown: Countdown | null; examMode: boolean; unattempted: number } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/exam")
      .then((r) => r.json())
      .then((j) => {
        if (!alive || !j?.ok) return;
        const questions = (j.data.questions ?? []) as { attemptedAt?: string | null }[];
        setData({
          countdown: j.data.countdown,
          examMode: j.data.examMode,
          unattempted: questions.filter((q) => !q.attemptedAt).length,
        });
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  if (!data?.examMode || !data.countdown) return null;
  const c = data.countdown;

  return (
    <Link href="/exam" className={`xs-strip xs-${c.phase}`}>
      <Timer size={15} />
      <b>{Math.max(0, c.days)}</b>
      <span className="xs-sub">{c.days === 1 ? "day" : "days"} to {c.exam.subject}</span>
      <span className="xs-focus">{c.headline}</span>
      {data.unattempted > 0 && <span className="xs-pill">{data.unattempted} unattempted</span>}
      <ArrowRight size={13} className="xs-arrow" />
    </Link>
  );
}
