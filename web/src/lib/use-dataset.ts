"use client";

import useSWR from "swr";

import type { Dataset } from "./types";

const DATA_URL = "/api/data";
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

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
} {
  const { data, error, isLoading, isValidating } = useSWR<Dataset, Error>(DATA_URL, fetchDataset, {
    refreshInterval: REFRESH_INTERVAL_MS,
    revalidateOnFocus: true,
    keepPreviousData: true,
  });
  return { dataset: data, error, isLoading, isValidating };
}
