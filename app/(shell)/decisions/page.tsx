import type { Metadata } from "next";
import { DecisionsView } from "@/features/decisions/decisions-view";

export const metadata: Metadata = { title: "Decisions" };
export const dynamic = "force-dynamic";

export default function DecisionsPage() {
  return <DecisionsView />;
}
