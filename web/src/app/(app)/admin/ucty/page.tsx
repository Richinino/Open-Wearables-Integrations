import { PageIdentity } from "@/components/admin/page-identity";
import { sessionIdentity } from "@/lib/account-identity";
import Link from "next/link";
import { adminAccess } from "@/components/admin/access";
import { unstable_rethrow } from "next/navigation";
import { accountsApi } from "@/lib/owi-accounts";
import { ActionForm, Panel, Unavailable } from "@/components/admin/form";
import { accountName, dateLabel, sortAccounts, STATUS_LABELS } from "@/components/admin/helpers";
import { viewAccount } from "../actions";

export default async function AccountsPage() {
  const access = await adminAccess();
  if (!access.session) return <Unavailable message={access.error ?? undefined} />;
  const session = access.session;
  let accounts;
  try { accounts = sortAccounts(await accountsApi.adminAccounts(session.account.id)); }
  catch (error) { unstable_rethrow(error); return <Unavailable />; }
  return <PageIdentity expected={sessionIdentity(session)}><Panel title="Účty"><p className="text-sm text-ink2">Najprv účty čakajúce na spárovanie. Prepnúť účet otvorí jeho stránku iba na čítanie.</p><ul className="divide-y divide-line">{accounts.map((account) => <li key={account.id} className="flex min-w-0 flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><Link href={`/admin/ucty/${encodeURIComponent(account.id)}`} className="break-words text-lg font-semibold underline decoration-line-strong underline-offset-4">{accountName(account)}</Link><p className="break-words text-sm text-ink2">{account.email}</p><p className="mt-1 text-sm">{STATUS_LABELS[account.status]} · {account.role === "admin" ? "Administrátor" : "Používateľ"}</p><p className="mt-1 text-xs text-ink2">Posledné dáta: {dateLabel(account.last_data_at)}</p></div>{account.status === "active" && account.paired && account.id !== session.account.id && <ActionForm action={viewAccount} submit="Zobraziť jeho stránku"><input type="hidden" name="target" value={account.id} /></ActionForm>}</li>)}</ul>{accounts.length === 0 && <p className="text-ink2">Zatiaľ žiadne účty.</p>}</Panel></PageIdentity>;
}
