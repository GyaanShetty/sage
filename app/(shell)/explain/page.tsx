import type { Metadata } from "next";
import { FeynmanView } from "@/features/feynman/feynman-view";

export const metadata: Metadata = { title: "Explain" };
export const dynamic = "force-dynamic";

export default function ExplainPage() {
  return <FeynmanView />;
}
