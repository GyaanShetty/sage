import type { Metadata } from "next";
import { CounselView } from "@/features/counsel/counsel-view";

export const metadata: Metadata = {
  title: "Counsel",
  description: "A second opinion from SAGE, with your context already in the room.",
};
export const dynamic = "force-dynamic";

export default function CounselPage() {
  return <CounselView />;
}
