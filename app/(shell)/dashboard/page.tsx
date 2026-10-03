import type { Metadata } from "next";
import { Home } from "@/features/home/home";

export const metadata: Metadata = {
  title: "SAGE",
  description: "Today, markets, the read, and a field to ask anything.",
};

export default function DashboardPage() {
  return <Home />;
}
