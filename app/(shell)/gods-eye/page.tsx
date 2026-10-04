import type { Metadata } from "next";
import { GodsEye } from "@/features/gods-eye/gods-eye";

export const metadata: Metadata = {
  title: "God's Eye",
  description: "Live earthquakes, cyclones, aircraft, satellites and launches on one map.",
};
export const dynamic = "force-dynamic";

export default function Page() {
  return <GodsEye />;
}
