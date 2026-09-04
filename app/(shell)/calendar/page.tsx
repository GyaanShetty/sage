import type { Metadata } from "next";
import { CalendarView } from "@/features/calendar/calendar-view";

export const metadata: Metadata = {
  title: "Calendar",
  description: "The day and the week, with what each block is actually for.",
};
export const dynamic = "force-dynamic";

export default function CalendarPage() {
  return <CalendarView />;
}
