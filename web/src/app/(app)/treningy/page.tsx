import type { Metadata } from "next";
import { WorkoutsView } from "./workouts";

export const metadata: Metadata = { title: "Tréningy" };

export default function WorkoutsPage() {
  return <WorkoutsView />;
}
