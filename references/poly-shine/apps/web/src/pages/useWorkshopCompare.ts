import { useCallback, useEffect, useState } from "react";
import { fetchWorkshopPortfolio, fetchWorkshopPortfolioBatch } from "../api/hooks";
import type { PolymarketPortfolioResult, PolymarketPortfolioSnapshot } from "../types";

export const WORKSHOP_COMPARE_STORAGE_KEY = "poly-shine-workshop-compare";

const ADDRESS_RE = /^0x[a-f0-9]{40}$/;

export type CompareRowState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: PolymarketPortfolioSnapshot };

export function normalizeCompareAddress(raw: string) {
  return raw.trim().toLowerCase();
}

export function isValidCompareAddress(address: string) {
  return ADDRESS_RE.test(address);
}

function isPortfolioError(v: PolymarketPortfolioResult): v is { error: string } {
  return "error" in v;
}

function loadCompareAddresses(): string[] {
  try {
    const raw = localStorage.getItem(WORKSHOP_COMPARE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((a): a is string => typeof a === "string")
      .map(normalizeCompareAddress)
      .filter(isValidCompareAddress);
  } catch {
    return [];
  }
}

function saveCompareAddresses(addresses: string[]) {
  localStorage.setItem(WORKSHOP_COMPARE_STORAGE_KEY, JSON.stringify(addresses));
}

export function useWorkshopCompare() {
  const [compareAddresses, setCompareAddresses] = useState<string[]>(() => loadCompareAddresses());
  const [rows, setRows] = useState<Record<string, CompareRowState>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [tableError, setTableError] = useState<string | null>(null);

  const applyPortfolioResults = useCallback((portfolios: Record<string, PolymarketPortfolioResult>) => {
    setRows((prev) => {
      const next = { ...prev };
      for (const [addr, result] of Object.entries(portfolios)) {
        if (isPortfolioError(result)) {
          next[addr] = { status: "error", message: result.error };
        } else {
          next[addr] = { status: "ready", data: result };
        }
      }
      return next;
    });
  }, []);

  const loadPortfolios = useCallback(
    async (addresses: string[]) => {
      if (addresses.length === 0) return;
      setRows((prev) => {
        const next = { ...prev };
        for (const addr of addresses) next[addr] = { status: "loading" };
        return next;
      });
      setTableError(null);
      try {
        const { portfolios } = await fetchWorkshopPortfolioBatch(addresses);
        applyPortfolioResults(portfolios);
      } catch (e) {
        setTableError(e instanceof Error ? e.message : "Failed to refresh comparison");
      }
    },
    [applyPortfolioResults]
  );

  useEffect(() => {
    saveCompareAddresses(compareAddresses);
  }, [compareAddresses]);

  useEffect(() => {
    if (compareAddresses.length === 0) return;
    void loadPortfolios(compareAddresses);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- initial hydrate only

  const addToComparison = useCallback(
    async (address: string, snapshot?: PolymarketPortfolioSnapshot) => {
      const normalized = normalizeCompareAddress(address);
      if (!isValidCompareAddress(normalized)) return;

      let added = false;
      setCompareAddresses((prev) => {
        if (prev.includes(normalized)) return prev;
        added = true;
        return [...prev, normalized];
      });
      if (!added) return;

      setTableError(null);

      if (snapshot) {
        setRows((prev) => ({ ...prev, [normalized]: { status: "ready", data: snapshot } }));
        return;
      }

      setRows((prev) => ({ ...prev, [normalized]: { status: "loading" } }));
      try {
        const data = await fetchWorkshopPortfolio(normalized);
        setRows((prev) => ({ ...prev, [normalized]: { status: "ready", data } }));
      } catch (e) {
        setRows((prev) => ({
          ...prev,
          [normalized]: {
            status: "error",
            message: e instanceof Error ? e.message : "Failed to load portfolio",
          },
        }));
      }
    },
    []
  );

  const removeFromComparison = useCallback((address: string) => {
    setCompareAddresses((prev) => prev.filter((a) => a !== address));
    setRows((prev) => {
      const next = { ...prev };
      delete next[address];
      return next;
    });
  }, []);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    await loadPortfolios(compareAddresses);
    setRefreshing(false);
  }, [compareAddresses, loadPortfolios]);

  return {
    compareAddresses,
    rows,
    tableError,
    refreshing,
    addToComparison,
    removeFromComparison,
    refreshAll,
  };
}

export type WorkshopCompare = ReturnType<typeof useWorkshopCompare>;
