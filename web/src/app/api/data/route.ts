import { currentSession } from "@/lib/auth";
import { accountsApi, OwiAccountError } from "@/lib/owi-accounts";
import { DatasetUnavailableError, loadDataset } from "@/lib/owi";

// No `dynamic = "force-dynamic"` here: reading the session cookie already makes every call
// run at request time, and loadDataset asks owi afresh each time.

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(): Promise<Response> {
  // The proxy checks the session too; this is the check next to the data.
  try {
    const session = await currentSession();
    if (!session) return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
    if (session.account.status !== "active" || !session.account.paired) return Response.json({ error: "pending" }, { status: 403, headers: NO_STORE });
    const accountId = session.claims.x ?? session.claims.a;
    if (session.claims.x) {
      const target = await accountsApi.getAccount(accountId);
      if (target.status !== "active" || !target.paired || target.id !== accountId) return Response.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
    }
    return Response.json(await loadDataset(accountId), { headers: NO_STORE });
  } catch (error) {
    if (!(error instanceof DatasetUnavailableError) && !(error instanceof OwiAccountError)) throw error;
    console.error(`api/data: dataset unavailable (${error.message})`);
    return Response.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
}
