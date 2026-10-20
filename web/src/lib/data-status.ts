import { isStale } from "./metrics";
import type { Dataset } from "./types";

export function dataStatus(dataset: Dataset, now: Date, failed = false) {
  if (failed) return { warning: true, title: "Spojenie so zdrojom zlyhalo.",
    detail: "Vidíš posledné načítané hodnoty. Stránka spojenie skúsi znova." };
  if (isStale(dataset.last_compute_success_at ?? dataset.synced_at, now)) {
    return { warning: true, title: "Prepočet dát sa dlhšie neozval.",
      detail: "Zobrazené výsledky nemusia obsahovať najnovšie merania." };
  }
  if (dataset.latest_measurement_at !== undefined && isStale(dataset.latest_measurement_at, now)) {
    return { warning: true, title: "Chýbajú nové merania zo zariadení.",
      detail: "Server odpovedá, ale telefón alebo hodinky zatiaľ neposlali novšie merania." };
  }
  return { warning: false, title: "Dáta sú dostupné.", detail: "Výsledky sa pravidelne prepočítavajú." };
}
