import { AuthFrame } from "../login/auth-frame";
import { AuthForm } from "../login/login-form";
export const metadata = { title: "Zabudnuté heslo" };
export default function ResetRequestPage() { return <AuthFrame title="Zabudnuté heslo" description="Správca dostane žiadosť a odkaz na nové heslo ti pošle osobne."><AuthForm mode="request" /></AuthFrame>; }
