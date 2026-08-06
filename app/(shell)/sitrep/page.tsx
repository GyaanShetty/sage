import type { Metadata } from "next";
import { SitrepView } from "@/features/sitrep/sitrep-view";

export const metadata: Metadata = { title: "Sitrep" };
export const dynamic = "force-dynamic";

export default function SitrepPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <SitrepView />
    </div>
  );
}
