import type { Metadata } from "next";
import { Glows, Mark } from "@/components/shell/shell";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Prihlásenie" };

export default function LoginPage() {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-clip px-4 py-16">
      <Glows />
      <div className="absolute top-5 right-4 sm:right-8">
        <ThemeToggle compact />
      </div>
      <div className="glass rise relative w-full max-w-[400px] p-7 sm:p-9">
        <Mark size={34} />
        <p className="eyebrow mt-8">Súkromný prehľad</p>
        <h1 className="figure mt-3 text-[64px]">Zdravie</h1>
        <p className="mt-3 text-[15px] text-ink2">Kroky, spánok, skóre a tréningy na jednom mieste. Pokračuj heslom.</p>
        <LoginForm />
      </div>
    </main>
  );
}
