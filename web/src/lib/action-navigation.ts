"use client";

import type { AccountActionState } from "./account-input";

/** Cookie mutations can unmount a form before an effect; navigate in its pending continuation. */
export async function runAccountAction(
  action: (state: AccountActionState, form: FormData) => Promise<AccountActionState>,
  previous: AccountActionState,
  form: FormData,
): Promise<AccountActionState> {
  const result = await action(previous, form);
  if (result.reload) window.location.reload();
  else if (result.navigate) window.location.assign(result.navigate);
  return result;
}
