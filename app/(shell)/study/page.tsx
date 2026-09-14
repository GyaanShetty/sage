import type { Metadata } from "next";
import { StudyView } from "@/features/study/study-view";

/**
 * The study wall.
 *
 * Separate from /education, which is the skill ledger — a 0–5 level per topic,
 * the right shape for competence that has no end. This is the finite half: a
 * semester, with a syllabus that runs out and a paper at the end of it.
 */
export const metadata: Metadata = {
  title: "Study",
  description: "Subjects, units, hours and the timetable — what is done and what is left.",
};
export const dynamic = "force-dynamic";

export default function StudyPage() {
  return <StudyView />;
}
