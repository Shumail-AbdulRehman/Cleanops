import { describe, expect, it } from 'vitest';
import { formatCount, formatDate, formatDaysAgo, formatMoney } from './consoleFormat';

describe('console formatting', () => {
  it.each([formatMoney, formatCount, formatDate, formatDaysAgo])('shows unavailable values consistently (%#)', (format) => {
    expect(format(null)).toBe('Not available');
  });

  it('formats money in its currency and omits decimals for whole amounts', () => {
    expect(formatMoney({ amount: 1060, currency: 'USD' })).toBe('$1,060');
    expect(formatMoney({ amount: 1060.5, currency: 'EUR' })).toBe('€1,060.50');
    expect(formatMoney({ amount: 0, currency: 'USD' })).toBe('$0');
  });

  it('formats full and compact counts without losing zero', () => {
    expect(formatCount(26746)).toBe('26,746');
    expect(formatCount(26746, true)).toBe('26.7K');
    expect(formatCount(0, true)).toBe('0');
  });

  it('formats short dates using the Karachi day', () => {
    expect(formatDate('2026-11-17T19:00:00Z')).toBe('Nov 18, 2026');
    expect(formatDate('2026-11-17')).toBe('Nov 17, 2026');
  });

  it('counts Karachi calendar days for relative dates', () => {
    const now = new Date('2026-11-19T19:00:00Z');
    expect(formatDaysAgo('2026-11-18T18:59:00Z', now)).toBe('2 days ago');
    expect(formatDaysAgo('2026-11-18T19:00:00Z', now)).toBe('1 day ago');
    expect(formatDaysAgo('2026-11-17T19:00:00Z', now)).toBe('2 days ago');
    expect(formatDaysAgo('2026-11-20', now)).toBe('Today');
  });
});
