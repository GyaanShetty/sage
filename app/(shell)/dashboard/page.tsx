import type { Metadata } from "next";
import { CommandView } from "@/features/dashboard/components/command-view";
import { ExamStrip } from "@/features/dashboard/components/exam-strip";
import { loadDeck } from "@/features/dashboard/load";

/**
 * The wall — thirty panes on one screen.
 *
 * This is the dashboard and it is what he wants a dashboard to be. It briefly
 * was not: the deck took this route for one commit and he asked for the
 * terminal back immediately. The deck still exists at /deck; it is not what
 * this screen is for.
 */
export const metadata: Metadata = {
  title: "Command",
  description: "Every live reading in SAGE on one screen — markets, health, mail, deadlines and agents.",
};
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const data = await loadDeck();
  return (
    <div>
      {/* Above everything, and only when a paper is close. */}
      <ExamStrip />
      <CommandView {...data} />
    </div>
  );
}
