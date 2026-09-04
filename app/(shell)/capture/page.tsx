import type { Metadata } from "next";
import { CaptureView } from "@/features/capture/capture-view";

export const metadata: Metadata = {
  title: "Capture",
  description: "Drop anything here and SAGE files it.",
};
export const dynamic = "force-dynamic";

export default function CapturePage() {
  return <CaptureView />;
}
