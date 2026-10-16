import { hasValidSession } from "@/lib/auth";
import { DatasetUnavailableError, loadDataset } from "@/lib/owi";

// No `dynamic = "force-dynamic"` here: reading the session cookie already makes every call
// run at request time, and loadDataset asks owi afresh each time.

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(): Promise<Response> {
  // The proxy checks the session too; this is the check next to the data.
  if (!(await hasValidSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  try {
    return Response.json(await loadDataset(), { headers: NO_STORE });
  } catch (error) {
    if (!(error instanceof DatasetUnavailableError)) throw error;
    console.error(`api/data: dataset unavailable (${error.message})`);
    return Response.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
}
