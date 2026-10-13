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
        className="mt-2 block w-full rounded-xl bg-surface px-4 py-3 text-[16px] ring-1 ring-line-strong outline-none transition-shadow placeholder:text-muted focus:ring-2 focus:ring-ink"
      />
      <p id="login-error" role="alert" className="mt-2 min-h-5 text-[13px] font-medium text-bad">
        {state.error}
      </p>
      <button
        type="submit"
        disabled={pending}
        className="mt-2 w-full rounded-xl bg-ink px-4 py-3 text-[15px] font-semibold text-page transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Overujem…" : "Prihlásiť"}
      </button>
    </form>
  );
}
