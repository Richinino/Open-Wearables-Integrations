import { AuthFrame } from "../login/auth-frame";
import { AuthForm } from "../login/login-form";
export const metadata = { title: "Registrácia" };
export default function RegisterPage() { return <AuthFrame title="Vytvor si účet" description="Po registrácii správca spáruje tvoj účet s dátami z hodiniek."><AuthForm mode="register" /></AuthFrame>; }
