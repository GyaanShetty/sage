import type { Metadata } from "next";
import { FeynmanView } from "@/features/feynman/feynman-view";

export const metadata: Metadata = {
  title: "Explain",
  description: "Ask SAGE to explain anything, at the depth you need.",
};
export const dynamic = "force-dynamic";

export default function ExplainPage() {
  return <FeynmanView />;
}
