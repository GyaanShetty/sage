import type { Metadata } from "next";
import { MorningBlock } from "@/features/morning/morning-block";

export const metadata: Metadata = {
  title: "Morning Block",
  description: "The morning brief: weather, calendar, mail and markets before you start.",
};
export const dynamic = "force-dynamic";

export default function MorningPage() {
  return <MorningBlock />;
}
