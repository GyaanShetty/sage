import type { Metadata } from "next";
import { DeckView } from "@/features/dashboard/components/deck-view";
import { ExamStrip } from "@/features/dashboard/components/exam-strip";
import { loadDeck } from "@/features/dashboard/load";

/** The three-column deck, with the mark at its centre. Kept off /dashboard. */
export const metadata: Metadata = {
  title: "Deck",
  description: "The mark, an ask bar, and the day around it.",
};
export const dynamic = "force-dynamic";

export default async function DeckPage() {
  const data = await loadDeck();
  return (
    <div>
      <ExamStrip />
      <DeckView {...data} />
    </div>
  );
}
