import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import {
  SESSION_COOKIE,
  SESSION_LIFETIME_MS,
  createSessionToken,
  verifySessionToken,
} from "./session";

function digest(text: string): Buffer {
  return createHash("sha256").update(text, "utf8").digest();
}

export async function checkPassword(submitted: string): Promise<boolean> {
  const password = process.env.SITE_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  if (!password || !secret) {
    console.error("Login is disabled: SITE_PASSWORD or SESSION_SECRET is not set.");
    return false;
  }
  // Hashing first gives both sides the same length, so the comparison leaks nothing about it.
  return timingSafeEqual(digest(submitted), digest(password));
}

export async function startSession(): Promise<void> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");

  const token = await createSessionToken(secret, Date.now());
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_LIFETIME_MS / 1000,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function hasValidSession(): Promise<boolean> {
  const store = await cookies();
  return verifySessionToken(
    process.env.SESSION_SECRET,
    store.get(SESSION_COOKIE)?.value,
    Date.now(),
  );
}
