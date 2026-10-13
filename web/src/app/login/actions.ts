"use server";

import { redirect } from "next/navigation";

import { checkPassword, endSession, startSession } from "@/lib/auth";

export interface LoginState {
  error: string | null;
}

const FAILURE_DELAY_MS = 800;

export async function login(previous: LoginState, formData: FormData): Promise<LoginState> {
  const submitted = formData.get("password");
  const accepted =
    typeof submitted === "string" && submitted.length > 0 && (await checkPassword(submitted));

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
