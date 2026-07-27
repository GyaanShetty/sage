import type { Metadata } from "next";
import { ReviewView } from "@/features/review/review-view";

export const metadata: Metadata = { title: "Review" };
export const dynamic = "force-dynamic";

export default function ReviewPage() {
  return <ReviewView />;
}
