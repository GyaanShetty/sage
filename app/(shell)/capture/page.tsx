import type { Metadata } from "next";
import { CaptureView } from "@/features/capture/capture-view";

export const metadata: Metadata = { title: "Capture" };
export const dynamic = "force-dynamic";

export default function CapturePage() {
  return <CaptureView />;
}
