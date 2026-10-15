import type { Metadata } from "next";
import { ReadinessView } from "@/components/detail/readiness/readiness-view";

export const metadata: Metadata = { title: "Pripravenosť" };

export default function ReadinessPage() {
  return <ReadinessView />;
}
