import { describe, expect, it } from 'vitest';
import { schedulePageUrdu } from './schedulePageTranslations.ts';
import { translate } from './translations.ts';

describe('schedule page translations', () => {
  it.each(Object.entries(schedulePageUrdu))('translates %s and preserves its placeholders', (key, urdu) => {
    expect(urdu).not.toBe(key);
    expect(urdu).toMatch(/\p{Script=Arabic}/u);
    expect((urdu.match(/\{\w+\}/g) ?? []).sort()).toEqual((key.match(/\{\w+\}/g) ?? []).sort());
  });

  it('looks up a schedule page label in Urdu', () => {
    expect(translate('Search schedules, areas or staff', 'ur')).toBe('شیڈول، حصے یا عملہ تلاش کریں');
  });

  it('looks up a schedule page duration and interpolates both values', () => {
    expect(translate('{hours} h {minutes} min', 'ur', { hours: 2, minutes: 30 })).toBe('2 گھنٹے 30 منٹ');
  });
});
