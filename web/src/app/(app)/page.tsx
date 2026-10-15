import type { Metadata } from "next";
import { Suspense } from "react";
import { OverviewView } from "./overview";

export const metadata: Metadata = { title: "Prehľad" };

export default function OverviewPage() {
  // The overview reads ?rezim= (morning or evening layout), which needs a Suspense boundary.
  return (
    <Suspense>
      <OverviewView />
    </Suspense>
  );
}
