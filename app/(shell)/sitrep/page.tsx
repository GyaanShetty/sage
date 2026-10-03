import type { Metadata } from "next";
import { SitrepView } from "@/features/sitrep/sitrep-view";

export const metadata: Metadata = {
  title: "Sitrep",
  description: "The situation, summarised: what changed and what needs you.",
};
export const dynamic = "force-dynamic";

export default function SitrepPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <SitrepView />
    </div>
  );
}
