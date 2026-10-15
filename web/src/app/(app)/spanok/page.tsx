import type { Metadata } from "next";
import { SleepView } from "@/components/detail/sleep/sleep-view";

export const metadata: Metadata = { title: "Spánok" };

export default function SleepPage() {
  return <SleepView />;
}
