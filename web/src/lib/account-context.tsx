"use client";

import { createContext, useContext } from "react";
import type { Account } from "./account-types";

export interface AccountContextValue {
  account: Account;
  dataAccount: Account;
  viewOnly: boolean;
  persistent: boolean;
}

const AccountContext = createContext<AccountContextValue | null>(null);

export function AccountProvider({ value, children }: { value: AccountContextValue; children: React.ReactNode }) {
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount() { return useContext(AccountContext); }
