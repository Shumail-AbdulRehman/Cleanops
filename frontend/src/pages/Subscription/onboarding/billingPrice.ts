import type { BillingInterval } from '../types';

export type BillingPrice = {
  formatted: string;
  decimalAmount: string;
  currencyCode: string;
  fractionDigits: number;
  interval: BillingInterval;
};

/** Exact recurring price, never a total due today or annual/monthly equivalent. */
export function formatBillingPrice(amount: unknown, currencyCode: unknown, interval: BillingInterval, locale = 'en-PK'): BillingPrice | null {
  if (typeof amount !== 'string' || !/^(0|[1-9]\d*)$/.test(amount) || amount.length > 32 ||
      typeof currencyCode !== 'string' || !/^[A-Z]{3}$/.test(currencyCode) || !['month', 'year'].includes(interval)) return null;
  try {
    // Intl accepts invented three-letter codes; require an actually supported currency.
    if (!Intl.supportedValuesOf('currency').includes(currencyCode)) return null;
    const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode });
    const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 0;
    const padded = amount.padStart(fractionDigits + 1, '0');
    const whole = fractionDigits ? padded.slice(0, -fractionDigits) : padded;
    const fraction = fractionDigits ? padded.slice(-fractionDigits) : '';
    const digitFormat = new Intl.NumberFormat(locale, { useGrouping: false });
    const localizedFraction = [...fraction].map((digit) => digitFormat.format(Number(digit))).join('');
    const formatted = formatter.formatToParts(BigInt(whole)).map((part) => part.type === 'fraction' ? localizedFraction : part.value).join('');
    return { formatted, decimalAmount: whole + (fractionDigits ? `.${fraction}` : ''), currencyCode, fractionDigits, interval };
  } catch { return null; }
}
