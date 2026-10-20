import { adminAccess } from "@/components/admin/access";
import { unstable_rethrow } from "next/navigation";
import { accountsApi } from "@/lib/owi-accounts";
import { ActionForm, Field, INPUT, Panel, Unavailable } from "@/components/admin/form";
import { dateLabel } from "@/components/admin/helpers";
import { adminAction } from "../actions";

export default async function SystemPage() {
  const access = await adminAccess();
  if (!access.session) return <Unavailable message={access.error ?? undefined} />;
  const session = access.session;
  let system;
  try { system = await accountsApi.system(session.account.id); }
  catch (error) { unstable_rethrow(error); return <Unavailable />; }
  return <div className="grid min-w-0 gap-[18px] lg:grid-cols-2"><Panel title="Stav systému"><dl className="space-y-4 text-sm"><div><dt className="text-ink2">Open Wearables · výsledok posledného prepočtu</dt><dd className={system.ow_api === "ok" ? "text-good-ink" : "text-warn"}>{system.ow_api === "ok" ? "Dostupný pri poslednom behu" : "Výpadok alebo ešte neoverené"}</dd></div><div><dt className="text-ink2">Posledný beh owi</dt><dd>{dateLabel(system.last_sync_at)}</dd></div><div><dt className="text-ink2">Verzia Open Wearables</dt><dd>{system.ow_version ?? "Neznáma"}{system.ow_latest && <> · Najnovšia: {system.ow_latest}</>}</dd></div><div><dt className="text-ink2">Funnel · posledná udalosť</dt><dd className="break-words">{system.funnel.last_event ?? "Zatiaľ nie je k dispozícii"}</dd><dd className="mt-1 text-xs text-ink2">{dateLabel(system.funnel.last_event_at)}</dd></div></dl><p className="text-xs text-ink2">Stav vychádza z poslednej synchronizácie a záznamu dohľadu, nejde o priebežný živý test.</p></Panel><Panel title="Registrácia"><p className="text-sm text-ink2">Otvorená registrácia dovolí vytvoriť účet. K dátam sa nový používateľ dostane až po spárovaní.</p><ActionForm action={adminAction} submit="Uložiť registráciu"><input type="hidden" name="operation" value="registration" /><Field label="Prijímanie nových účtov"><select className={INPUT} name="registration_open" defaultValue={String(system.registration_open)}><option value="true">Registrácia otvorená</option><option value="false">Registrácia zatvorená</option></select></Field></ActionForm></Panel></div>;
}
