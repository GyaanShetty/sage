import type { Metadata } from "next";
import { ReviewView } from "@/features/review/review-view";

export const metadata: Metadata = {
  title: "Review",
  description: "The weekly review — what you did, and what it added up to.",
};
export const dynamic = "force-dynamic";

export default function ReviewPage() {
  return <ReviewView />;
}
