import Link from "next/link";
import { requireSession } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  if (session.account.role !== "admin" || session.account.status !== "active") return <p role="alert" className="glass p-6">Táto časť je prístupná iba administrátorovi.</p>;
  if (session.claims.x) return <p role="status" className="glass p-6">Počas prezerania cudzieho účtu je admin panel zamknutý. Najprv sa vráť na svoj účet cez pruh hore.</p>;
  return <><div className="px-1"><p className="eyebrow">Administrácia</p><h1 className="mt-1 text-3xl font-semibold">Admin panel</h1></div><nav aria-label="Admin panel" className="flex flex-wrap gap-2"><Link className="pill pill-outline" href="/admin">Inbox</Link><Link className="pill pill-outline" href="/admin/ucty">Účty</Link><Link className="pill pill-outline" href="/admin/system">Stav systému</Link></nav>{children}</>;
}
