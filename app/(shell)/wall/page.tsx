import type { Metadata } from "next";
import { CommandView } from "@/features/dashboard/components/command-view";
import { ExamStrip } from "@/features/dashboard/components/exam-strip";
import { loadDeck } from "@/features/dashboard/load";

/**
 * The dense wall — thirty panes on one screen.
 *
 * This was /dashboard until the deck took that route, and it is not a legacy
 * screen kept out of sentiment: maximum density is a thing he asked for
 * explicitly and at length, and the deck deliberately does not try to be it.
 * Same data, different claim about what a dashboard is for.
 */
export const metadata: Metadata = {
  title: "Wall",
  description: "Every pane in SAGE on one screen, at maximum density.",
};
export const dynamic = "force-dynamic";

export default async function WallPage() {
  const data = await loadDeck();
  return (
    <div>
      <ExamStrip />
      <CommandView {...data} />
    </div>
  );
}
