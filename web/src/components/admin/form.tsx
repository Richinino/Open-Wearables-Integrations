"use client";

import { startTransition, useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { AccountActionState } from "@/lib/account-input";
import { useAccount } from "@/lib/account-context";
import { IDENTITY_FIELD, type AccountIdentity } from "@/lib/account-identity";
import { runAccountAction } from "@/lib/action-navigation";

export const INPUT = "min-h-11 w-full min-w-0 rounded-xl border border-line-strong bg-bg px-3 py-2 text-ink";

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex min-w-0 flex-col gap-1.5 text-sm font-semibold">{label}{children}</label>;
}

export function Submit({ children, danger = false }: { children: React.ReactNode; danger?: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className={`pill pill-outline max-w-full disabled:cursor-wait disabled:opacity-50 ${danger ? "!border-bad !text-bad" : ""}`}>{pending ? "Ukladám…" : children}</button>;
}

export function ActionForm({ action, children, submit = "Uložiť", danger = false, disabled = false, expectedIdentity }: {
  action: (state: AccountActionState, form: FormData) => Promise<AccountActionState>;
  children?: React.ReactNode;
  submit?: string;
  danger?: boolean;
  disabled?: boolean;
  expectedIdentity?: AccountIdentity;
}) {
  const account = useAccount();
  const identity = expectedIdentity ?? (account ? { actorId: account.account.id, dataAccountId: account.dataAccount.id, viewOnly: account.viewOnly } : null);
  const [state, formAction] = useActionState((previous: AccountActionState, form: FormData) => runAccountAction(action, previous, form), {});
  return <form action={formAction} className="flex min-w-0 flex-col gap-4">
    <input type="hidden" name={IDENTITY_FIELD} value={identity ? JSON.stringify(identity) : ""} />
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-4 disabled:opacity-60">{children}<div><Submit danger={danger}>{submit}</Submit></div></fieldset>
    {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
    {state.success && <p role="status" className="text-sm text-good-ink">{state.success}</p>}
    {state.resetPath && <ResetLink path={state.resetPath} expiresAt={state.expiresAt} />}
  </form>;
}

function ResetLink({ path, expiresAt }: { path: string; expiresAt?: string }) {
  const [feedback, copyAction, pending] = useActionState(async () => {
    try { await navigator.clipboard.writeText(new URL(path, window.location.origin).href); return "Odkaz je skopírovaný."; }
    catch { return "Kopírovanie sa nepodarilo. Označ a skopíruj odkaz ručne."; }
  }, "");
  return <div className="space-y-2 rounded-xl border border-line p-3">
    <p className="text-sm">Jednorazový odkaz. Pošli ho majiteľovi účtu súkromne. {expiresAt && <>Platí do {new Date(expiresAt).toLocaleString("sk-SK")}.</>}</p>
    <input className={INPUT} readOnly aria-label="Jednorazový odkaz na nové heslo" value={typeof window === "undefined" ? path : new URL(path, window.location.origin).href} onFocus={(event) => event.target.select()} />
    <button type="button" className="pill pill-outline" disabled={pending} onClick={() => { startTransition(() => copyAction()); }}>Kopírovať odkaz</button>
    {feedback && <p role="status" className="text-sm text-ink2">{feedback}</p>}
  </div>;
}

export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="glass min-w-0 space-y-5 p-5 sm:p-7"><h2 className="text-xl font-semibold">{title}</h2>{children}</section>;
}

export function Unavailable({ message = "Údaje sú teraz nedostupné. Skús stránku obnoviť o chvíľu." }: { message?: string }) {
  return <p role="alert" className="rounded-xl border border-warn bg-warn-bg p-4 text-sm text-ink">{message}</p>;
}
