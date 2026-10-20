"use client";
import { useActionState, useEffect } from "react";
import { login, register, requestReset, confirmReset, logoutForNavigation, type LoginState } from "./actions";
const inputClass = "mt-2 block h-12 w-full rounded-[18px] border border-line-strong bg-glass px-4 text-base outline-none focus:border-ink focus:ring-1 focus:ring-ink";
export function AuthForm({ mode = "login", token = "" }: { mode?: "login" | "register" | "request" | "reset"; token?: string }) {
  const action = mode === "register" ? register : mode === "request" ? requestReset : mode === "reset" ? confirmReset.bind(null, token) : login;
  const [state, submit, pending] = useActionState(action, { error: null } as LoginState);
  useEffect(() => { if (state.destination) window.location.assign(state.destination); }, [state.destination]);
  const field = (name: string, label: string, type: string, autocomplete: string, required = true) => <label className="block text-sm text-ink2" key={name}>{label}<input name={name} type={type} autoComplete={autocomplete} required={required} maxLength={type === "password" ? 256 : name === "email" ? 254 : 100} minLength={type === "password" && mode !== "login" ? 10 : undefined} aria-describedby={state.error ? "auth-error" : undefined} className={inputClass} /></label>;
  return <form action={submit} className="mt-7 space-y-4">
    {mode === "register" && <>{field("first_name", "Meno", "text", "given-name")}{field("last_name", "Priezvisko (nepovinné)", "text", "family-name", false)}</>}
    {mode !== "reset" && field("email", "E-mail", "email", "email")}
    {mode !== "request" && field("password", mode === "reset" ? "Nové heslo" : "Heslo", "password", mode === "login" ? "current-password" : "new-password")}
    {(mode === "register" || mode === "reset") && <>{field("repeat", "Heslo znova", "password", "new-password")}<p className="text-xs text-muted">Aspoň 10 znakov.</p></>}
    {mode === "login" && <label className="flex gap-2 text-sm text-ink2"><input name="remember" type="checkbox" />Zostať prihlásený</label>}
    <p id="auth-error" role="alert" className="min-h-5 text-sm text-bad">{state.error}</p>
    {state.success && <p role="status" className="text-sm text-ink2">{state.success}</p>}
    <button type="submit" disabled={pending || !!state.destination} className="h-12 w-full rounded-[24px] bg-ink text-[15px] font-semibold text-bg hover:opacity-90 disabled:opacity-60">{pending ? "Čakaj…" : mode === "register" ? "Vytvoriť účet" : mode === "request" ? "Požiadať o nové heslo" : mode === "reset" ? "Zmeniť heslo" : "Prihlásiť"}</button>
    <nav className="flex flex-wrap justify-between gap-3 text-sm text-ink2" aria-label="Prístup k účtu">{mode === "login" ? <><a href="/registracia" className="underline">Zaregistruj sa</a><a href="/zabudnute-heslo" className="underline">Zabudnuté heslo</a></> : <a href="/login" className="underline">Späť na prihlásenie</a>}</nav>
  </form>;
}
export function LoginForm() { return <AuthForm />; }
export function AuthLogoutButton() {
  const [state, action, pending] = useActionState(logoutForNavigation, { error: null } as LoginState);
  useEffect(() => { if (state.destination) window.location.assign(state.destination); }, [state.destination]);
  return <form action={action}><button disabled={pending} className="mt-5 rounded-full border border-line-strong px-5 py-3 disabled:opacity-60">Odhlásiť sa</button></form>;
}
