import type { Metadata } from "next";
import { Suspense } from "react";
import { CalendarView } from "@/components/detail/calendar/calendar-view";

export const metadata: Metadata = { title: "Kalendár" };

export default function CalendarPage() {
  // The calendar reads ?den= and ?pohlad= to open on a given day, which needs a Suspense boundary.
  return (
    <Suspense>
      <CalendarView />
    </Suspense>
  );
}
