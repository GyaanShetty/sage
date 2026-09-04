import type { Metadata } from "next";
import { HealthView } from "@/features/health/health-view";
import "@/features/dashboard/command.css";

export const metadata: Metadata = {
  title: "Health",
  description: "Sleep, heart, oxygen, activity and intake, from Apple Health.",
};
export const dynamic = "force-dynamic";

export default function HealthPage() {
  return <HealthView />;
}
