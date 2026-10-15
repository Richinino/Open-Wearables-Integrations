import type { Metadata } from "next";
import { HeartView } from "@/components/detail/heart/heart-view";

export const metadata: Metadata = { title: "Pokojový tep" };

export default function HeartPage() {
  return <HeartView />;
}
