import { AuthFrame } from "../../login/auth-frame";
import { AuthForm } from "../../login/login-form";
export const metadata = { title: "Nové heslo", referrer: "no-referrer" };
export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) { const { token } = await params; return <AuthFrame title="Nové heslo" description="Odkaz je jednorazový a platí 24 hodín."><AuthForm mode="reset" token={token} /></AuthFrame>; }
