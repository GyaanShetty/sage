import type { Metadata } from "next";
import { ComingSoon } from "@/components/ui/coming-soon";

export const metadata: Metadata = { title: "Knowledge" };

export default function KnowledgePage() {
  return <ComingSoon title="Knowledge" phase="Phase 2" />;
}
