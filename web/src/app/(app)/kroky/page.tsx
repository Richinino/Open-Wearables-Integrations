import type { Metadata } from "next";
import { DetailPlaceholder } from "@/components/detail-placeholder";

export const metadata: Metadata = { title: "Kroky" };

// Placeholder until the detail page is built.
export default function StepsPage() {
  return (
    <DetailPlaceholder
      eyebrow="Kroky"
      title="Kroky"
      intro="Kroky po dňoch, týždňoch a mesiacoch, aj odhad vzdialenosti."
      coming={[
        "Kroky za 7, 30 a 90 dní s porovnaním s predošlým obdobím",
        "Rozdiel medzi pracovnými dňami a víkendom",
        "Vzdialenosť ako odhad z krokov a zdroj krokov pre každý deň",
      ]}
    />
  );
}
