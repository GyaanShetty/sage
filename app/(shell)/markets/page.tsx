import type { Metadata } from "next";
import { MarketsView } from "@/features/markets/components/markets-view";

export const metadata: Metadata = {
  title: "Markets",
  description: "Indices, holdings, crypto, FX and sector heat, on one Bloomberg-style wall.",
};

export default function MarketsPage() {
  return <MarketsView />;
}
