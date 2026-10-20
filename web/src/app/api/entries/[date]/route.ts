import { currentSession } from "@/lib/auth";
import { OwiAccountError } from "@/lib/owi-accounts";
import { checkBody, checkDay, type FieldErrors } from "@/lib/entries";
import { entryDayBounds, saveEntry } from "@/lib/owi-entries";
import { IDENTITY_HEADER, parseIdentity, sameIdentity, sessionIdentity } from "@/lib/account-identity";

// Saves one day's Samsung Health entry: session, same origin, owi's ranges, then on to owi
// with the write token. Nothing about the token, owi's address or its answers is logged.

const NO_STORE = { "Cache-Control": "private, no-store" };
/** Seven numbers fit easily; anything longer is not a form save. */
const MAX_BODY_CHARS = 2_000;

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function firstHost(value: string | null): string | null {
  const host = value?.split(",")[0]?.trim().toLowerCase();
  return host ? host : null;
}

/**
 * Browsers send Origin on every PUT, and a page elsewhere cannot forge it. The host it names
 * must be this site's, as the request reached it (Host) or as the proxy in front saw it.
 */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const own = [firstHost(request.headers.get("host")), firstHost(request.headers.get("x-forwarded-host"))];
  return own.some((item) => item !== null && item === host);
}

async function readBody(request: Request): Promise<unknown> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return undefined;
  }
  if (text.length > MAX_BODY_CHARS) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function PUT(request: Request, context: { params: Promise<{ date: string }> }): Promise<Response> {
  // The proxy checks the session too; this is the check next to the write.
  let session;
  try { session = await currentSession(); }
  catch (error) { if (error instanceof OwiAccountError) return json({ error: "unavailable" }, 503); throw error; }
  if (!session) return json({ error: "unauthorized" }, 401);
  const identity = sessionIdentity(session);
  if (!sameIdentity(parseIdentity(request.headers.get(IDENTITY_HEADER)), identity)) return json({ error: "session_changed" }, 409);
  if (session.claims.x) return json({ error: "read_only" }, 403);
  if (session.account.status !== "active" || !session.account.paired) return json({ error: "pending" }, 403);
  if (!session.account.has_samsung) return json({ error: "unsupported_source" }, 403);
  if (!isSameOrigin(request)) return json({ error: "forbidden" }, 403);

  const { date } = await context.params;
  const fields: FieldErrors = {};
  const dayProblem = checkDay(date, entryDayBounds());
  if (dayProblem) fields.day = dayProblem;
  const checked = checkBody(await readBody(request));
  if (!checked.ok) Object.assign(fields, checked.fields);
  if (!checked.ok || dayProblem) return json({ error: "invalid", fields }, 400);

  const outcome = await saveEntry(session.account.id, date, checked.values);
  switch (outcome.kind) {
    case "saved":
      return Response.json(outcome.entry, { status: 200, headers: { ...NO_STORE, [IDENTITY_HEADER]: JSON.stringify(identity) } });
    case "invalid":
      return json({ error: "invalid", fields: outcome.fields }, 400);
    case "unavailable":
      console.error(`api/entries: owi unavailable (${outcome.reason})`);
      return json({ error: "unavailable" }, 503);
  }
}
