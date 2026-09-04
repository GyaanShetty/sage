import type { Metadata } from "next";
import { ExamView } from "@/features/exam/exam-view";

export const metadata: Metadata = {
  title: "Exams",
  description: "Exam countdowns, syllabus coverage and practice.",
};
export const dynamic = "force-dynamic";

export default function ExamPage() {
  return <ExamView />;
}
