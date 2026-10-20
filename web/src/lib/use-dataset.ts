"use client";

import { useCallback } from "react";
import useSWR from "swr";
import { useAccount } from "./account-context";

import type { Dataset } from "./types";

const DATA_URL = "/api/data";
const REFRESH_INTERVAL_MS = 60 * 1000;

async function fetchDataset(url: string): Promise<Dataset> {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });

  if (response.status === 401) {
    // A full page load on purpose: the session is gone, so client state should go with it.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
    // Stays pending on purpose: the page is being replaced, and settling either way would
    // flash an error or an empty state on the way out.
    return new Promise<Dataset>(() => {});
  }
  if (response.status !== 200) throw new Error(String(response.status));

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
  const key = account ? [DATA_URL, account.dataAccount.id] as const : DATA_URL;
  const { data, error, isLoading, isValidating, mutate } = useSWR<Dataset, Error>(key,
    (value: string | readonly [string, string]) => fetchDataset(typeof value === "string" ? value : value[0]), {
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
  return { dataset: data, error, isLoading, isValidating, update };
}
