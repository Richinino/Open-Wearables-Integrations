import { requireSession } from "@/lib/auth";
import { ActionForm, Field, INPUT, Panel } from "@/components/admin/form";
import { changeOwnPassword, deleteOwnAccount, logoutEverywhere, updateProfile } from "@/lib/account-actions";

export default async function AccountPage() {
  const { account, claims } = await requireSession();
  const viewOnly = Boolean(claims.x);
  return <>
    <div className="px-1"><p className="eyebrow">Tvoj profil</p><h1 className="mt-1 text-3xl font-semibold">Nastavenia účtu</h1><p className="mt-2 text-ink2">Osobné údaje pre tvoj účet a výpočty. Heslo vidíš iba ty.</p></div>
    {viewOnly && <p role="status" className="text-warn">Prezeráš cudzí účet. Svoj profil môžeš meniť po návrate na svoj účet.</p>}
    <div className="grid min-w-0 gap-[18px] lg:grid-cols-2">
      <Panel title="Osobné údaje"><ActionForm action={updateProfile} disabled={viewOnly} submit="Uložiť profil">
        <div className="grid min-w-0 gap-4 sm:grid-cols-2"><Field label="Meno"><input className={INPUT} name="first_name" autoComplete="given-name" required maxLength={100} defaultValue={account.first_name} /></Field><Field label="Priezvisko (nepovinné)"><input className={INPUT} name="last_name" autoComplete="family-name" maxLength={100} defaultValue={account.last_name ?? ""} /></Field></div>
        <Field label="E-mail"><input className={INPUT} type="email" name="email" autoComplete="email" required maxLength={254} defaultValue={account.email} /></Field>
        <Field label="Dátum narodenia (nepovinný)"><input className={INPUT} type="date" name="birth_date" autoComplete="bday" defaultValue={account.birth_date ?? ""} /></Field>
        <Field label="Pohlavie pre výpočty"><select className={INPUT} name="sex" defaultValue={account.sex ?? ""}><option value="">Neuvádzam</option><option value="female">Žena</option><option value="male">Muž</option></select></Field>
        <label className="flex items-start gap-3 text-sm"><input className="mt-1 size-4 shrink-0" type="checkbox" name="training_consent" defaultChecked={account.training_consent} /><span>Súhlasím s trénovaním na mojich údajoch<span className="mt-1 block text-ink2">Vypnutím sa údaje prestanú používať na dolaďovanie vzorcov. Skóre a zobrazenie fungujú ďalej.</span></span></label>
      </ActionForm></Panel>
      <div className="flex min-w-0 flex-col gap-[18px]">
        <Panel title="Zmena hesla"><ActionForm action={changeOwnPassword} disabled={viewOnly} submit="Zmeniť heslo"><Field label="Aktuálne heslo"><input className={INPUT} name="current_password" type="password" autoComplete="current-password" required /></Field><Field label="Nové heslo (aspoň 10 znakov)"><input className={INPUT} name="new_password" type="password" autoComplete="new-password" minLength={10} required /></Field><Field label="Nové heslo znova"><input className={INPUT} name="repeat_password" type="password" autoComplete="new-password" minLength={10} required /></Field></ActionForm></Panel>
        <Panel title="Prihlásené zariadenia"><p className="text-sm text-ink2">Odhlási všetky zariadenia vrátane tohto. Na potvrdenie napíš ODHLÁSIŤ.</p><ActionForm action={logoutEverywhere} disabled={viewOnly} submit="Odhlásiť všetky zariadenia"><Field label="Potvrdenie odhlásenia"><input className={INPUT} name="confirmation" autoComplete="off" placeholder="ODHLÁSIŤ" required /></Field></ActionForm></Panel>
      </div>
    </div>
    <Panel title="Zmazanie účtu"><p className="max-w-2xl text-sm text-ink2">Natrvalo zmaže účet, jeho vypočítané dni, zápisy aj doladené čísla. Surové dáta v Open Wearables ostanú. Na potvrdenie napíš ZMAZAŤ a vyplň svoje heslo.</p><div className="max-w-lg"><ActionForm action={deleteOwnAccount} danger disabled={viewOnly} submit="Natrvalo zmazať môj účet"><Field label="Potvrdenie zmazania"><input className={INPUT} name="confirmation" autoComplete="off" placeholder="ZMAZAŤ" required /></Field><Field label="Tvoje heslo"><input className={INPUT} name="password" type="password" autoComplete="current-password" required /></Field></ActionForm></div></Panel>
  </>;
}
