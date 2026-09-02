import type { Metadata } from "next";
import { OpsView } from "@/features/dashboard/components/ops-view";

export const metadata: Metadata = { title: "Ops" };
export const dynamic = "force-dynamic";

/**
 * The second wall.
 *
 * Everything here fetches from the client, so the page itself has nothing to
 * do — unlike /dashboard, which needs tasks and events server-side to render
 * without a flash of empty panes. Keeping this a thin shell means the route
 * costs no function time on a free tier.
 */
export default function OpsPage() {
  return <OpsView />;
}
