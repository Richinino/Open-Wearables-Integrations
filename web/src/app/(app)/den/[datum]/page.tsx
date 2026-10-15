import type { Metadata } from "next";
import { DayView } from "@/components/detail/day/day-view";
import { isValidDay } from "@/lib/dates";
import { formatDay } from "@/lib/format";

export async function generateMetadata({ params }: PageProps<"/den/[datum]">): Promise<Metadata> {
  const { datum } = await params;
  return { title: isValidDay(datum) ? `Deň · ${formatDay(datum)}` : "Deň" };
}

export default async function DayPage({ params }: PageProps<"/den/[datum]">) {
  const { datum } = await params;
  return <DayView date={datum} />;
}
