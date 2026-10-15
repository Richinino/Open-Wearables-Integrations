import type { Metadata } from "next";
import { DetailPlaceholder } from "@/components/detail-placeholder";
import { SCORE_SOURCES } from "@/lib/scores";

export const metadata: Metadata = { title: "Pripravenosť" };

// Placeholder until the detail page is built.
export default function ReadinessPage() {
  return (
    <DetailPlaceholder
      eyebrow="Pripravenosť"
      title="Readiness"
      intro="Ako je telo pripravené na deň: z nočného tepu, spánku a záťaže posledných dní. Je to odhad, lebo hodinky neposielajú HRV ani teplotu."
      coming={[
        "Readiness po dňoch a jeho zložky: spánok, pokojový tep, bilancia aktivity a spánku, zotavenie v noci",
        "Nočný tep oproti tvojmu normálu a história varovaní",
        "Ako sa pripravenosť mení po náročných dňoch",
      ]}
      source={SCORE_SOURCES.readiness}
    />
  );
}
