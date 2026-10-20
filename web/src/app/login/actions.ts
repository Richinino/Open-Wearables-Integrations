"use server";

import { redirect } from "next/navigation";

import { checkPassword, endSession, startSession } from "@/lib/auth";
import { reserveLoginAttempt } from "@/lib/login-limit";

export interface LoginState {
  error: string | null;
}

const FAILURE_DELAY_MS = 800;

export async function login(previous: LoginState, formData: FormData): Promise<LoginState> {
  const quota = await reserveLoginAttempt();
  if (quota !== "allowed") {
    return { error: quota === "limited"
      ? "Priveľa pokusov. Skús to znova o 15 minút."
      : "Prihlásenie je dočasne nedostupné. Skús to znova neskôr." };
  }
  const submitted = formData.get("password");
  const accepted =
    typeof submitted === "string" && submitted.length > 0 && submitted.length <= 256 &&
    (await checkPassword(submitted));

  if (!accepted) {
    // Same delay and message whatever the reason, so a caller learns nothing from the failure.
    await new Promise((resolve) => setTimeout(resolve, FAILURE_DELAY_MS));
    return { error: "Nesprávne heslo" };
  }

  await startSession();
  redirect("/");
}

export async function logout(): Promise<void> {
  await endSession();
  redirect("/login");
}
