import type { Metadata } from "next";
import { ComingSoon } from "@/components/ui/coming-soon";

export const metadata: Metadata = { title: "Memory" };

export default function MemoryPage() {
  return <ComingSoon title="Memory" phase="Phase 1" />;
}
