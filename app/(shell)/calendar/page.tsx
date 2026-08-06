import type { Metadata } from "next";
import { CalendarView } from "@/features/calendar/calendar-view";

export const metadata: Metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";

export default function CalendarPage() {
  return <CalendarView />;
}
