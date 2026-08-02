import type { Metadata } from "next";
import { EducationView } from "@/features/education/components/education-view";

export const metadata: Metadata = { title: "Education" };
export const dynamic = "force-dynamic";

export default function EducationPage() {
  return <EducationView />;
}
