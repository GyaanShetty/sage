import type { Metadata } from "next";
import { CareerView } from "@/features/career/career-view";

export const metadata: Metadata = { title: "Career" };
export const dynamic = "force-dynamic";

export default function CareerPage() {
  return <CareerView />;
}
