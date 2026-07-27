import type { Metadata } from "next";
import { MorningBlock } from "@/features/morning/morning-block";

export const metadata: Metadata = { title: "Morning Block" };
export const dynamic = "force-dynamic";

export default function MorningPage() {
  return <MorningBlock />;
}
