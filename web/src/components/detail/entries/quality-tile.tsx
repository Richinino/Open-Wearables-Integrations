// "Ako presne owi trafí Samsung": the deviation of each tuned estimate and score from the
// numbers in the entries, on days the tuning has not seen. Server-safe.

import { TileShell } from "@/components/ui/tile";
import { formatRelative } from "@/lib/format";
import { qualityRows } from "@/lib/samsung";
import type { Calibration } from "@/lib/types";

export function QualityTile({ calibration, now }: { calibration: Calibration | null | undefined; now: Date }) {
  const rows = qualityRows(calibration);
  const entries = calibration?.entries ?? 0;
  return (
    <TileShell className="gap-5 p-6 sm:p-[30px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="eyebrow">Ako presne owi trafí Samsung</h2>
        {calibration?.fitted_at && (
          <span className="mono text-[11px] tracking-[0.04em] text-muted">doladené {formatRelative(calibration.fitted_at, now)}</span>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-[14px] text-ink2">
          {entries > 0
            ? "Na porovnanie je zatiaľ málo zápisov. Odchýlka sa ukáže po ďalšom doladení."
            : "Zatiaľ žiadny zápis. Po prvých dňoch tu uvidíš, o koľko sa odhady owi líšia od Samsungu."}
        </p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 xl:grid-cols-6">
          {rows.map((row) => (
            <div key={row.key} className="flex min-w-0 flex-col gap-1.5 border-t border-line pt-3">
              <dt className="text-[12px] text-ink2">{row.label}</dt>
              <dd className="figure-sm text-[24px] whitespace-nowrap sm:text-[28px]">{row.error}</dd>
              <dd className="text-[12px] text-muted">
                {row.basis}
                {row.improved && (
                  <span className="whitespace-nowrap">
                    {" · "}
                    <span className="font-semibold text-good-ink">↓ z {row.previous}</span>
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <p className="text-[12px] text-muted">
        Priemerná odchýlka owi od Samsungu na dňoch, ktoré dolaďovanie nevidelo. Menšia je lepšia, ↓ je zlepšenie oproti
        predošlému nastaveniu.
      </p>
    </TileShell>
  );
}
