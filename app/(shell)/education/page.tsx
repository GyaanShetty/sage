import type { Metadata } from "next";
import { EducationView } from "@/features/education/components/education-view";

export const metadata: Metadata = {
  title: "Education",
  description: "The skill ledger — what you are learning and how far along.",
};
export const dynamic = "force-dynamic";

export default function EducationPage() {
  return <EducationView />;
}
