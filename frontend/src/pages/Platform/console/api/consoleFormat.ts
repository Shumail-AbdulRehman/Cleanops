import type { Money } from './consoleApi';

export const NOT_AVAILABLE = 'Not available';

const timeZone = 'Asia/Karachi';
const countFormat = new Intl.NumberFormat('en-US');
const compactCountFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const shortDateFormat = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'short', day: 'numeric' });
const calendarDateFormat = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' });
const relativeFormat = new Intl.RelativeTimeFormat('en-US', { numeric: 'always' });
const dayInMs = 24 * 60 * 60 * 1000;

export function formatMoney(value: Money | null): string {
  if (value === null) return NOT_AVAILABLE;
  const { amount, currency } = value;
  return amount.toLocaleString('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : undefined,
  });
}

export function formatCount(value: number | null, compact = false): string {
  if (value === null) return NOT_AVAILABLE;
  return (compact ? compactCountFormat : countFormat).format(value);
}

function parseDate(value: string | null) {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value: string | null): string {
  const date = parseDate(value);
  return date === null ? NOT_AVAILABLE : shortDateFormat.format(date);
}

function calendarDay(date: Date) {
  const parts = calendarDateFormat.formatToParts(date);
  const month = Number(parts.find(({ type }) => type === 'month')?.value);
  const day = Number(parts.find(({ type }) => type === 'day')?.value);
  const year = Number(parts.find(({ type }) => type === 'year')?.value);
  return Date.UTC(year, month - 1, day) / dayInMs;
}

export function formatDaysAgo(value: string | null, now = new Date()): string {
  const date = parseDate(value);
  if (date === null) return NOT_AVAILABLE;
  const days = calendarDay(date) - calendarDay(now);
  return days === 0 ? 'Today' : relativeFormat.format(days, 'day');
}
