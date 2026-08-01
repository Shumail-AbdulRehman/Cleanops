import { describe, expect, it } from 'vitest';
import { translate } from './translations.ts';
import { workDaysUrdu } from './workDaysTranslations.ts';

describe('web work days translations', () => {
  it.each(Object.entries(workDaysUrdu))('registers Urdu for %s', (key, value) => {
    expect(value.trim()).not.toBe('');
    expect(value).not.toBe(key);
    expect(value.match(/\{\w+\}/g)?.sort() ?? []).toEqual(
      key.match(/\{\w+\}/g)?.sort() ?? [],
    );
    expect(translate(key, 'ur')).toBe(value);
  });

  it('translates the Every day summary', () => {
    expect(translate('Every day', 'ur')).toBe('ہر روز');
  });
});
