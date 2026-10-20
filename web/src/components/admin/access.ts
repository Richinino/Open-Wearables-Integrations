import "server-only";
import { unstable_rethrow } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { accountErrorMessage } from "@/lib/account-forms";

/** Pages authorize independently: Next.js may render a page alongside its layout. */
export async function adminAccess() {
  try { return { session: await requireAdmin(), error: null }; }
  catch (error) { unstable_rethrow(error); return { session: null, error: accountErrorMessage(error) }; }
}
