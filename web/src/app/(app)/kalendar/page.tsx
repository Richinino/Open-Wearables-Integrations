import type { Metadata } from "next";
import { DetailPlaceholder } from "@/components/detail-placeholder";

export const metadata: Metadata = { title: "Kalendár" };

// Placeholder until the detail page is built.
export default function CalendarPage() {
  return (
    <DetailPlaceholder
      eyebrow="Kalendár"
      title="Kalendár"
      intro="Mesiac a týždeň na jednej obrazovke: skóre dňa, kroky, spánok a tréningy pre každý deň."
      coming={[
        "Mesačný pohľad s kruhom skóre, krokmi, spánkom a tréningom v každom dni",
        "Týždenný pohľad s podrobnosťami dňa",
        "Súhrn mesiaca alebo týždňa v priemere",
      ]}
    />
  );
}
