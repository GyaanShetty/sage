import type { Metadata } from "next";
import { ReportView } from "@/features/report/components/report-view";

export const metadata: Metadata = {
  title: "Report",
  description: "Cross-domain review of your month, in one document.",
};
export const dynamic = "force-dynamic";

export default function ReportPage() {
  return <ReportView />;
}
