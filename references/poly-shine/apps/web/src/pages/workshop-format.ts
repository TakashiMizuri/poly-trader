export function shortAddr(addr: string) {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function fmtUsd(amount: number | null | undefined) {
  if (amount == null || !Number.isFinite(amount)) return "—";
  return amount.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function fmtValuationTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function pnlClass(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value === 0) return "text-muted-foreground";
  return value > 0 ? "text-primary" : "text-danger";
}
