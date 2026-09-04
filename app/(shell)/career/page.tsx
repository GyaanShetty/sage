import type { Metadata } from "next";
import { CareerView } from "@/features/career/career-view";

export const metadata: Metadata = {
  title: "Career",
  description: "Applications, stages, deadlines and the opportunities found in your inbox.",
};
export const dynamic = "force-dynamic";

export default function CareerPage() {
  return <CareerView />;
}
