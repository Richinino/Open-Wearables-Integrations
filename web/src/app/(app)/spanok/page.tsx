import type { Metadata } from "next";
import { SleepView } from "./sleep";

export const metadata: Metadata = { title: "Spánok" };

export default function SleepPage() {
  return <SleepView />;
}
