import type { Metadata } from "next";
import { PortfolioView } from "@/features/portfolio/portfolio-view";

export const metadata: Metadata = {
  title: "Portfolio",
  description: "Holdings, allocation, drawdown and performance over time.",
};
export const dynamic = "force-dynamic";

export default function PortfolioPage() {
  return <PortfolioView />;
}
