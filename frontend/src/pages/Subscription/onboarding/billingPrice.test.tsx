import { expect, it } from 'vitest';
import { formatBillingPrice } from './billingPrice';
it.each([
  ['1234', 'USD', '12.34', 2], ['1234', 'JPY', '1234', 0], ['1234', 'KWD', '1.234', 3],
  ['0', 'USD', '0.00', 2], ['1', 'KWD', '0.001', 3], ['100', 'USD', '1.00', 2],
])('formats exact %s minor units in %s', (amount, currency, decimal, digits) => {
  const result = formatBillingPrice(amount, currency, 'month', 'en-US');
  expect(result).toMatchObject({ decimalAmount: decimal, fractionDigits: digits, currencyCode: currency, interval: 'month' });
  expect(result?.formatted.replaceAll(',', '')).toContain(decimal);
});
it.each([null, undefined, 1234, Number.MAX_SAFE_INTEGER + 1, '-1', '1.2', 'NaN', '', '01', ' 1234', '1e6', '9'.repeat(33)])('rejects invalid/unsafe amount case %#', (amount) => {
  expect(formatBillingPrice(amount, 'USD', 'month')).toBeNull();
});
it.each(['ZZZ', 'usd', '', null, 'US', 'USDD', 'XXX'])('rejects unsupported currency case %#', (currency) => {
  expect(formatBillingPrice('1234', currency, 'month')).toBeNull();
});
it('keeps large decimal strings exact without Number conversion', () => {
  const result = formatBillingPrice('900719925474099399', 'USD', 'year', 'en-US');
  expect(result?.decimalAmount).toBe('9007199254740993.99');
  expect(result?.formatted).toBe('$9,007,199,254,740,993.99');
});
it('annual is the full recurring annual price, with no inferred monthly amount or discount', () => {
  const result = formatBillingPrice('123400', 'USD', 'year', 'en-US');
  expect(result).toEqual({ formatted: '$1,234.00', decimalAmount: '1234.00', currencyCode: 'USD', fractionDigits: 2, interval: 'year' });
  expect(JSON.stringify(result)).not.toMatch(/discount|trial|dueToday|monthlyEquivalent/);
});
it('localizes numeric separators/fractions without changing the actual amount', () => {
  const result = formatBillingPrice('123456', 'USD', 'month', 'de-DE');
  expect(result?.formatted).toContain('1.234,56');
  expect(result?.decimalAmount).toBe('1234.56');
  expect(formatBillingPrice('1234', 'KWD', 'month', 'ar-KW')?.formatted).toContain('١٫٢٣٤');
});
it('fails safely for invalid locale', () => {
  expect(formatBillingPrice('1234', 'USD', 'month', 'bad_locale')).toBeNull();
});
