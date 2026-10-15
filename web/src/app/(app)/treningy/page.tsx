import type { Metadata } from "next";
import { WorkoutsView } from "@/components/detail/workouts/workouts-view";

export const metadata: Metadata = { title: "Tréningy" };

export default function WorkoutsPage() {
  return <WorkoutsView />;
}
