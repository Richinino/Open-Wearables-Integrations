"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const INITIAL: LoginState = { error: null };

export function LoginForm() {
  const [state, action, pending] = useActionState(login, INITIAL);
  return (
    <form action={action} className="mt-8">
      <label htmlFor="password" className="eyebrow">
        Heslo
      </label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        autoFocus
        required
        aria-invalid={state.error ? true : undefined}
        aria-describedby={state.error ? "login-error" : undefined}
        className="mt-2.5 block h-12 w-full rounded-[18px] border border-line-strong bg-glass px-4 text-[16px] outline-none transition-colors placeholder:text-muted focus:border-ink focus:ring-1 focus:ring-ink"
      />
      <p id="login-error" role="alert" className="mt-2 min-h-5 text-[13px] font-medium text-bad">
        {state.error}
      </p>
      <button
        type="submit"
        disabled={pending}
        className="mt-2 h-12 w-full rounded-[24px] bg-ink text-[15px] font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Overujem…" : "Prihlásiť"}
      </button>
    </form>
  );
}
