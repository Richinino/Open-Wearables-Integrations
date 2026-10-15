import type { Metadata } from "next";
import { DetailPlaceholder } from "@/components/detail-placeholder";
import { SCORE_SOURCES } from "@/lib/scores";

export const metadata: Metadata = { title: "Aktivita" };

// Placeholder until the detail page is built.
export default function ActivityPage() {
  return (
    <DetailPlaceholder
      eyebrow="Aktivita"
      title="Activity a Strain"
      intro="Pohyb počas dňa, záťaž z tréningov a stav záťaže za posledné týždne."
      coming={[
        "Activity po dňoch a jeho zložky: denné ciele, sedenie, objem a frekvencia tréningov",
        "Strain dňa na stupnici 0–21 a podiel jednotlivých tréningov",
        "Stav záťaže: posledných 7 dní oproti 4 týždňom",
        "Aktívny čas a kalórie, oba ako odhad",
      ]}
      source={`${SCORE_SOURCES.activity} · ${SCORE_SOURCES.strain} · ${SCORE_SOURCES.cardioLoad}`}
    />
  );
}
