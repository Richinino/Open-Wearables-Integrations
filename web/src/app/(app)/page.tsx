import type { Metadata } from "next";
import { OverviewView } from "./overview";

export const metadata: Metadata = { title: "Prehľad" };

export default function OverviewPage() {
  return <OverviewView />;
}
