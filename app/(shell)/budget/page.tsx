import type { Metadata } from "next";
import { BudgetView } from "@/features/budget/budget-view";

export const metadata: Metadata = {
  title: "Budget",
  description: "Where the month's money is going, against where it was meant to.",
};
export const dynamic = "force-dynamic";

export default function BudgetPage() {
  return <BudgetView />;
}
