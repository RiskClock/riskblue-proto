export type CurrencyCode = "USD" | "GBP";

export const CURRENCY_OPTIONS: { code: CurrencyCode; label: string; symbol: string }[] = [
  { code: "USD", label: "Dollar", symbol: "$" },
  { code: "GBP", label: "Pound", symbol: "£" },
];

export const normalizeCurrencyCode = (value?: string | null): CurrencyCode =>
  value === "GBP" ? "GBP" : "USD";

export const currencySymbol = (currencyCode?: string | null) =>
  normalizeCurrencyCode(currencyCode) === "GBP" ? "£" : "$";

export const formatCurrencyAmount = (amount: number, currencyCode?: string | null): string => {
  const symbol = currencySymbol(currencyCode);
  return `${symbol}${Math.round(amount).toLocaleString("en-US")}`;
};

export const formatCompactCurrencyAmount = (amount?: number | null, currencyCode?: string | null): string => {
  const symbol = currencySymbol(currencyCode);
  const value = Number(amount ?? 0) || 0;
  if (value >= 1000000) return `${symbol}${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${symbol}${(value / 1000).toFixed(1)}K`;
  return `${symbol}${value}`;
};