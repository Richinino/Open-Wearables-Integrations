import Link from "next/link";
import { adminAccess } from "@/components/admin/access";
import { unstable_rethrow } from "next/navigation";
import { accountsApi } from "@/lib/owi-accounts";
import { ActionForm, Panel, Unavailable } from "@/components/admin/form";
import { dateLabel } from "@/components/admin/helpers";
import { adminAction } from "./actions";

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ vybavene?: string }> }) {
  const access = await adminAccess();
  if (!access.session) return <Unavailable message={access.error ?? undefined} />;
  const session = access.session;
  const resolved = (await searchParams).vybavene === "1";
  let items;
  try { items = await accountsApi.inbox(session.account.id, resolved); }
  catch (error) { unstable_rethrow(error); return <Unavailable />; }
  return <Panel title="Inbox"><div className="flex flex-wrap gap-2"><Link href="/admin" className="pill pill-outline" aria-current={!resolved ? "page" : undefined}>Otvorené</Link><Link href="/admin?vybavene=1" className="pill pill-outline" aria-current={resolved ? "page" : undefined}>Vybavené</Link></div>
    {items.length === 0 ? <p className="text-ink2">{resolved ? "Zatiaľ žiadne vybavené upozornenia." : "Všetko je vybavené. Žiadne otvorené upozornenia."}</p> : <ul className="divide-y divide-line">{items.map((item) => <li key={item.id} className="flex min-w-0 flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="break-words font-semibold">{item.message}</p><p className="mt-1 text-xs text-ink2">{dateLabel(item.created_at)}{item.resolved_at && <> · Vybavené {dateLabel(item.resolved_at)}</>}</p>{item.account_id && <Link className="mt-2 inline-block text-sm underline" href={`/admin/ucty/${encodeURIComponent(item.account_id)}`}>Otvoriť účet</Link>}</div>{!resolved && <ActionForm action={adminAction} submit="Označiť za vybavené"><input type="hidden" name="operation" value="resolve" /><input type="hidden" name="target" value={item.id} /></ActionForm>}</li>)}</ul>}
  </Panel>;
}
