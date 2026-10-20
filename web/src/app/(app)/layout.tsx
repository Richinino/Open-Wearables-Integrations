import { Shell } from "@/components/shell/shell";
import { headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { currentSession } from "@/lib/auth";
import { accountsApi } from "@/lib/owi-accounts";
import { AccountProvider } from "@/lib/account-context";
import { ActionForm, Unavailable } from "@/components/admin/form";
import { exitView } from "./admin/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let session;
  try { session = await currentSession(); }
  catch (error) { unstable_rethrow(error); return <main className="mx-auto max-w-xl p-6 py-20"><Unavailable message="Účet sa teraz nedá overiť. Dáta zostávajú chránené. Skús stránku obnoviť o chvíľu." /></main>; }
  if (!session) redirect("/login");
  const pathname = (await headers()).get("x-account-pathname");
  if (session.account.status === "pending" && pathname !== "/ucet" && !pathname?.startsWith("/ucet/")) redirect("/cakanie");
  let dataAccount = session.account;
  if (session.claims.x) {
    try {
      if (session.account.role !== "admin" || session.account.status !== "active") throw new Error("forbidden");
      const target = await accountsApi.getAccount(session.claims.x);
      if (target.id !== session.claims.x || target.status !== "active" || !target.paired) throw new Error("invalid_target");
      dataAccount = target;
    } catch (error) {
      unstable_rethrow(error);
      return <main className="mx-auto flex max-w-xl flex-col gap-5 p-6 py-20"><Unavailable message="Prezeraný účet je nedostupný alebo už nie je aktívny. Vráť sa na svoj účet." /><ActionForm action={exitView} submit="Späť na môj účet" /></main>;
    }
  }
  return <AccountProvider value={{ account: session.account, dataAccount, viewOnly: Boolean(session.claims.x), persistent: session.claims.p }}><Shell>{children}</Shell></AccountProvider>;
}
