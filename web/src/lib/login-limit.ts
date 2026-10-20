import "server-only";

import { createHmac } from "node:crypto";
import { headers } from "next/headers";

export async function reserveLoginAttempt(): Promise<"allowed" | "limited" | "unavailable"> {
  const base = process.env.OWI_API_URL;
  if (!base && process.env.NODE_ENV !== "production") return "allowed";
  const token = process.env.OWI_WRITE_TOKEN;
  const secret = process.env.SESSION_SECRET;
  if (!base || !token || !secret) return "unavailable";
  // Vercel supplies and overwrites this header. Arbitrary forwarded headers are not trusted.
  const incoming = await headers();
  const address = process.env.VERCEL === "1"
    ? incoming.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    : "single-site";
  const clientKey = createHmac("sha256", secret).update(address).digest("hex");
  try {
    const response = await fetch(base.replace(/\/+$/, "") + "/v1/auth/attempt", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ client_key: clientKey }),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status === 429) return "limited";
    if (response.status !== 200) return "unavailable";
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null && "allowed" in body && body.allowed === true
      ? "allowed" : "unavailable";
  } catch {
    return "unavailable";
  }
}
