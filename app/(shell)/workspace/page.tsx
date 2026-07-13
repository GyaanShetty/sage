import type { Metadata } from "next";
import { ComingSoon } from "@/components/ui/coming-soon";

export const metadata: Metadata = { title: "Workspace" };

export default function WorkspacePage() {
  return <ComingSoon title="Workspace" phase="Phase 2" />;
}
