import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { OwiAccountError } from "@/lib/owi-accounts";
import { AuthFrame } from "../login/auth-frame";
import { AuthLogoutButton } from "../login/login-form";
export const metadata = { title: "Čaká sa na spárovanie" };
export default async function WaitingPage() {
  let session;
  try { session = await requireSession(); } catch (error) { if (!(error instanceof OwiAccountError)) throw error; return <AuthFrame title="Služba je nedostupná" description="Účet teraz nevieme overiť. Skús obnoviť stránku neskôr." />; }
  if (session.account.status === "active" && session.account.paired) redirect("/");
  return <AuthFrame title="Účet je vytvorený" description="Čaká sa na spárovanie účtu. Daj správcovi vedieť, že si sa zaregistroval."><a href="/ucet" className="mt-6 block underline">Nastavenia účtu</a><AuthLogoutButton /></AuthFrame>;
}
