import type { Metadata } from "next";
import { Suspense } from "react";
import { EntriesView } from "@/components/detail/entries/entries-view";

export const metadata: Metadata = { title: "Zápis" };

export default function EntriesPage() {
  // The page reads ?den= (a day to open), which needs a Suspense boundary.
  return (
    <Suspense>
      <EntriesView />
    </Suspense>
  );
}
