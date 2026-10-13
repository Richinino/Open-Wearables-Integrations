import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Prihlásenie" };

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center px-5 py-12">
      <div className="rise w-full max-w-[380px]">
        <svg width="44" height="44" viewBox="0 0 22 22" aria-hidden="true">
          <path d="M11 1a10 10 0 0 0 0 20Z" fill="var(--activity)" />
          <path d="M11 1a10 10 0 0 1 0 20Z" fill="var(--sleep)" />
        </svg>
        <h1 className="figure mt-8 text-[56px]">Zdravie</h1>
        <p className="mt-3 text-[15px] text-ink-2">
          Súkromný prehľad krokov, spánku a tréningov. Pokračuj heslom.
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
