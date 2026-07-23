import type { Metadata } from "next";
import { HoloLab } from "@/features/lab/holo-lab";

export const metadata: Metadata = { title: "Holo-Lab" };

export default function LabPage() {
  return <HoloLab />;
}
