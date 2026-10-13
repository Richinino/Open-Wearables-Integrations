import type { Metadata } from "next";
import { DayView } from "./day";

export const metadata: Metadata = { title: "Deň" };

export default function DayPage() {
  return <DayView />;
}
