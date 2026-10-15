import type { Metadata } from "next";
import { ActivityView } from "@/components/detail/activity/activity-view";

export const metadata: Metadata = { title: "Aktivita" };

export default function ActivityPage() {
  return <ActivityView />;
}
