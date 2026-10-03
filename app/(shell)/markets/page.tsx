import type { Metadata } from "next";
import { MarketsPage } from "@/features/markets/markets-page";

export const metadata: Metadata = {
  title: "Markets",
  description: "Your names, crypto, and the wider board.",
};

export default function Page() {
  return <MarketsPage />;
}
