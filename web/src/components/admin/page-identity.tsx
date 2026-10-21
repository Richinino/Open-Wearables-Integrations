"use client";

import { useEffect } from "react";
import { useAccount } from "@/lib/account-context";
import { sameIdentity, type AccountIdentity } from "@/lib/account-identity";

/** Fresh page authority must agree with the retained layout before displaying its RSC. */
export function PageIdentity({ expected, children }: {
  expected: AccountIdentity;
  children: React.ReactNode;
}) {
  const account = useAccount();
  const matches = Boolean(account && sameIdentity(expected, {
    actorId: account.account.id,
    dataAccountId: account.dataAccount.id,
    viewOnly: account.viewOnly,
    sessionVersion: account.account.session_version,
  }));
  useEffect(() => {
    if (!matches) window.location.reload();
  }, [matches]);
  if (!matches) return <p role="status">Účet sa zmenil v inom okne. Obnovujem stránku.</p>;
  return children;
}
