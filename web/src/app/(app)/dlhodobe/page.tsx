import type { Metadata } from "next";
import { DetailPlaceholder } from "@/components/detail-placeholder";
import { SCORE_SOURCES } from "@/lib/scores";

export const metadata: Metadata = { title: "Dlhodobé" };

// Placeholder until the detail page is built.
export default function LongTermPage() {
  return (
    <DetailPlaceholder
      eyebrow="Dlhodobé"
      title="Dlhodobé"
      intro="Ukazovatele, ktoré sa menia pomaly: kondícia, vek tela a rekordy."
      coming={[
        "VO2max z hodiniek a odhad z tepu (Uth–Sørensen)",
        "Vek tela a čo ho posúva hore alebo dole",
        "Rekordy za 90 dní a za celé obdobie",
      ]}
      source={SCORE_SOURCES.whoopAge}
    />
  );
}
