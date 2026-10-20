"use client";

import { AccountIdentityMismatchError } from "./account-identity";

/** Never accept the mismatched payload into SWR/form state while the document reloads. */
export function reloadChangedIdentity(): never {
  window.location.reload();
  throw new AccountIdentityMismatchError();
}
