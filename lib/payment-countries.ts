/**
 * Shared, client-safe payment country metadata.
 *
 * The authoritative gateway contract is https://pay.xdigitex.space/docs.
 * Mobile money network and currency are derived from the international phone
 * prefix. Card payments use the same detected currency when a phone is given.
 * Crypto is deliberately excluded: Malaba AI Studio accepts mobile money and
 * card only.
 */

export interface PaymentCountry {
  dialCode: string;
  country: string;
  currency: string;
  networks: string[];
  minWithdrawal: string;
  /** Approximate local units per 1 USD; KES is overridden by admin settings. */
  usdRate: number;
}

/** Sorted longest-first so `+243` is matched before a shorter prefix. */
export const PAYMENT_COUNTRIES: PaymentCountry[] = [
  { dialCode: "+229", country: "Benin", currency: "XOF", networks: ["Moov Benin", "MTN Benin"], minWithdrawal: "500 XOF", usdRate: 600 },
  { dialCode: "+226", country: "Burkina Faso", currency: "XOF", networks: ["Moov Burkina", "Orange Burkina"], minWithdrawal: "500 XOF", usdRate: 600 },
  { dialCode: "+237", country: "Cameroon", currency: "XAF", networks: ["MTN Cameroon"], minWithdrawal: "500 XAF", usdRate: 600 },
  { dialCode: "+225", country: "Côte d'Ivoire", currency: "XOF", networks: ["MTN Côte d'Ivoire", "Orange Côte d'Ivoire"], minWithdrawal: "500 XOF", usdRate: 600 },
  { dialCode: "+243", country: "DR Congo", currency: "CDF", networks: ["Airtel DRC", "Orange DRC", "Vodacom M-Pesa DRC"], minWithdrawal: "1,000 CDF", usdRate: 2850 },
  { dialCode: "+241", country: "Gabon", currency: "XAF", networks: ["Airtel Gabon"], minWithdrawal: "500 XAF", usdRate: 600 },
  { dialCode: "+254", country: "Kenya", currency: "KES", networks: ["M-Pesa (Safaricom)"], minWithdrawal: "10 KES", usdRate: 130 },
  { dialCode: "+242", country: "Republic of the Congo", currency: "XAF", networks: ["Airtel Congo", "MTN Congo"], minWithdrawal: "500 XAF", usdRate: 600 },
  { dialCode: "+250", country: "Rwanda", currency: "RWF", networks: ["Airtel Rwanda", "MTN Rwanda"], minWithdrawal: "500 RWF", usdRate: 1350 },
  { dialCode: "+221", country: "Senegal", currency: "XOF", networks: ["Free Senegal", "Orange Senegal"], minWithdrawal: "500 XOF", usdRate: 600 },
  { dialCode: "+232", country: "Sierra Leone", currency: "SLE", networks: ["Orange Sierra Leone"], minWithdrawal: "5 SLE", usdRate: 22 },
  { dialCode: "+256", country: "Uganda", currency: "UGX", networks: ["MTN Uganda", "Airtel Uganda"], minWithdrawal: "500 UGX", usdRate: 3600 },
  { dialCode: "+260", country: "Zambia", currency: "ZMW", networks: ["MTN Zambia", "Zamtel Zambia"], minWithdrawal: "5 ZMW", usdRate: 28 },
];

export const SUPPORTED_PAYMENT_CURRENCIES = Array.from(
  new Set(PAYMENT_COUNTRIES.map((entry) => entry.currency)),
).sort();

export type PaymentGateway = "mobile" | "card";

export interface DetectedPaymentNumber {
  dialCode: string;
  country: string;
  currency: string;
  networks: string[];
  nationalNumber: string;
  internationalNumber: string;
  usdRate: number;
}

/**
 * Detects country, currency and network from an international phone number.
 * A leading `00` is treated like `+`. Kenyan local `07...`/`01...` numbers are
 * accepted for convenience and normalised to `+254`.
 */
export function detectPaymentNumber(input: string): DetectedPaymentNumber | null {
  const trimmed = String(input ?? "").replace(/[\s().-]/g, "");
  if (!trimmed) return null;

  let normalized = trimmed;
  if (normalized.startsWith("00")) normalized = `+${normalized.slice(2)}`;
  else if (/^0[17]\d{8}$/.test(normalized)) normalized = `+254${normalized.slice(1)}`;
  else if (!normalized.startsWith("+")) normalized = `+${normalized}`;

  const country = PAYMENT_COUNTRIES.find((entry) => normalized.startsWith(entry.dialCode));
  if (!country) return null;

  const nationalNumber = normalized.slice(country.dialCode.length);
  if (nationalNumber.length < 6 || nationalNumber.length > 12 || !/^\d+$/.test(nationalNumber)) return null;

  return {
    dialCode: country.dialCode,
    country: country.country,
    currency: country.currency,
    networks: country.networks,
    nationalNumber,
    internationalNumber: `${country.dialCode}${nationalNumber}`,
    usdRate: country.usdRate,
  };
}

/** Currency amount a customer sees before they pay. Whole major units. */
export function localAmountFromUsd(usdPrice: number, unitsPerUsd: number): number {
  if (!Number.isFinite(usdPrice) || !Number.isFinite(unitsPerUsd) || unitsPerUsd <= 0) return 0;
  return Math.max(1, Math.round(usdPrice * unitsPerUsd));
}

export function formatLocalMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "USD" ? 2 : 0,
    }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString("en-US")}`;
  }
}

/** Server helper: KES always follows the admin-managed pricing setting. */
export function rateForCurrency(currency: string, kesRate: number): number {
  if (currency === "USD") return 1;
  if (currency === "KES" && Number.isFinite(kesRate) && kesRate > 0) return kesRate;
  return PAYMENT_COUNTRIES.find((entry) => entry.currency === currency)?.usdRate ?? 0;
}
