import { requireSession } from "@/lib/auth";
import { updateSettings } from "@/lib/account-actions";
import { ActionForm, Field, INPUT, Panel } from "@/components/admin/form";

export default async function SettingsPage() {
  const { account, claims } = await requireSession();
  return <><div className="px-1"><p className="eyebrow">Podľa teba</p><h1 className="mt-1 text-3xl font-semibold">Nastavenia</h1><p className="mt-2 text-ink2">Uložia sa k tvojmu účtu a platia na každom zariadení.</p></div>
    <div className="max-w-2xl"><Panel title="Vzhľad a prehľad"><ActionForm action={updateSettings} disabled={Boolean(claims.x)} submit="Uložiť nastavenia">
      <Field label="Vzhľad"><select className={INPUT} name="theme" defaultValue={account.settings.theme}><option value="system">Podľa systému</option><option value="light">Svetlý</option><option value="dark">Tmavý</option></select></Field>
      <Field label="Predvolené skóre spánku"><select className={INPUT} name="sleep_score" defaultValue={account.settings.sleep_score}><option value="performance">Sleep Performance</option><option value="apple">Sleep Score Apple</option><option value="samsung">Sleep Score Samsung</option></select></Field>
      <p className="text-sm text-ink2">Skóre zo zariadenia sa zobrazí, ak ho zdroj poskytuje. Chýbajúce skóre sa nenahrádza nulou.</p>
      <Field label="Režim prehľadu"><select className={INPUT} name="overview_mode" defaultValue={account.settings.overview_mode}><option value="auto">Ráno a večer automaticky</option><option value="morning">Vždy ranný prehľad</option></select></Field>
    </ActionForm></Panel></div></>;
}
