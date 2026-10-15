import type { Metadata } from "next";
import { StepsView } from "@/components/detail/steps/steps-view";

export const metadata: Metadata = { title: "Kroky" };

export default function StepsPage() {
  return <StepsView />;
}
