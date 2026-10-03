import type { Metadata } from "next";
import { WorkspacePage } from "@/features/workspace/workspace-page";

export const metadata: Metadata = {
  title: "Workspace",
  description: "The work in front of you, ranked.",
};
export const dynamic = "force-dynamic";

export default function Page() {
  return <WorkspacePage />;
}
