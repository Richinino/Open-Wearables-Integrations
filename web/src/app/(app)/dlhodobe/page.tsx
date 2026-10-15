import type { Metadata } from "next";
import { LongTermView } from "@/components/detail/longterm/longterm-view";

export const metadata: Metadata = { title: "Dlhodobé" };

export default function LongTermPage() {
  return <LongTermView />;
}
