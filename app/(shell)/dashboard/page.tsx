import type { Metadata } from "next";
import { DeckView } from "@/features/dashboard/components/deck-view";
import { ExamStrip } from "@/features/dashboard/components/exam-strip";
import { loadDeck } from "@/features/dashboard/load";

export const metadata: Metadata = {
  title: "Command",
  description: "Every live reading in SAGE on one screen — markets, health, mail, deadlines and agents.",
};
export const dynamic = "force-dynamic";

/**
 * The deck: the dashboard as the identity sheet draws it — three columns
 * around a centre that holds the mark.
 *
 * The dense wall this replaced is not gone; it lives at /wall and is one click
 * from here. That matters, because thirty panes on one screen is a thing he
 * asked for explicitly and at length, and a layout that quietly deleted
 * eighteen of them to look better in a screenshot would be answering a
 * different request from the one he made.
 */
export default async function DashboardPage() {
  const data = await loadDeck();
  return (
    <div>
      {/* Above everything, and only when a paper is close. */}
      <ExamStrip />
      <DeckView {...data} />
    </div>
  );
}
