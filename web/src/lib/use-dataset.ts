"use client";

import { useCallback } from "react";
import useSWR from "swr";
import { useAccount } from "./account-context";

import type { Dataset } from "./types";
import { AccountIdentityMismatchError, IDENTITY_HEADER, parseIdentity, sameIdentity, type AccountIdentity } from "./account-identity";
import { reloadChangedIdentity } from "./identity-client";

const DATA_URL = "/api/data";
const REFRESH_INTERVAL_MS = 60 * 1000;

export async function fetchDataset(url: string, identity: AccountIdentity): Promise<Dataset> {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", headers: { [IDENTITY_HEADER]: JSON.stringify(identity) } });

  if (response.status === 401) {
    // A full page load on purpose: the session is gone, so client state should go with it.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
    // Stays pending on purpose: the page is being replaced, and settling either way would
    // flash an error or an empty state on the way out.
    return new Promise<Dataset>(() => {});
  }
  if (response.status === 409) reloadChangedIdentity();
  if (response.status !== 200) throw new Error(String(response.status));
  if (!sameIdentity(identity, parseIdentity(response.headers.get(IDENTITY_HEADER)))) reloadChangedIdentity();

  return (await response.json()) as Dataset;
}

export function useDataset(): {
  dataset: Dataset | undefined;
  error: Error | undefined;
  isLoading: boolean;
  isValidating: boolean;
  /** Changes the loaded dataset in place, e.g. after a save, without asking owi again. */
  update: (change: (dataset: Dataset) => Dataset) => void;
} {
  const account = useAccount();
  const key = account ? [DATA_URL, account.account.id, account.dataAccount.id, account.viewOnly] as const : null;
  const { data, error, isLoading, isValidating, mutate } = useSWR<Dataset, Error>(key,
    (value: readonly [string, string, string, boolean]) => fetchDataset(value[0], { actorId: value[1], dataAccountId: value[2], viewOnly: value[3] }), {
    refreshInterval: REFRESH_INTERVAL_MS,
    revalidateOnFocus: true,
    keepPreviousData: false,
  });
  const update = useCallback(
    (change: (dataset: Dataset) => Dataset) => {
      void mutate((current) => (current ? change(current) : current), { revalidate: false });
    },
    [mutate],
  );
  return { dataset: error instanceof AccountIdentityMismatchError ? undefined : data, error, isLoading, isValidating, update };
}
