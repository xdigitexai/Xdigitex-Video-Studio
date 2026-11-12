export function formatMoney(micros: number, options: { cents?: boolean } = {}): string {
  if (!Number.isFinite(micros)) return "$0.00";
  const dollars = micros / 1_000_000;
  if (options.cents === false) return `$${dollars.toFixed(4)}`;
  return `$${dollars.toFixed(2)}`;
}

export function formatUsdCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatKes(amount: number): string {
  return `KES ${Math.round(amount).toLocaleString("en-KE")}`;
}

export function formatCredits(credits: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(credits));
}

export function formatDate(timestamp: number | null | undefined): string {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(timestamp: number | null | undefined): string {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function relativeTime(timestamp: number | null | undefined): string {
  if (!timestamp) return "—";
  const delta = Date.now() - timestamp;
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(timestamp);
}

export function percent(value: number, total: number): number {
  if (!total) return 0;
  return Math.min(100, Math.max(0, Math.round((value / total) * 100)));
}
