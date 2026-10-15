import type { Metadata } from "next";
import { DetailPlaceholder } from "@/components/detail-placeholder";

export const metadata: Metadata = { title: "Pokojový tep" };

// Placeholder until the detail page is built.
export default function HeartPage() {
  return (
    <DetailPlaceholder
      eyebrow="Tep"
      title="Pokojový tep"
      intro="Pokojový a nočný tep v čase, minimum a maximum dňa a zóny intenzity."
      coming={[
        "Pokojový tep za 30, 90 a 365 dní s trendom",
        "Nočný tep oproti tvojmu normálu",
        "Najnižší a najvyšší tep dňa a čas v zónach",
      ]}
    />
  );
}
