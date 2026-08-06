import type { Metadata } from "next";
import { CounselView } from "@/features/counsel/counsel-view";

export const metadata: Metadata = { title: "Counsel" };
export const dynamic = "force-dynamic";

export default function CounselPage() {
  return <CounselView />;
}
