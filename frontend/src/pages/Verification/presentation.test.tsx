import { expect, it } from 'vitest';
import { translate } from '@/i18n/translations';
import { plainReason } from './presentation';

it('a passed photo has its own wording, not the Setup "checked time" key', () => {
  expect(plainReason('PASSED')).toBe('Photo passed');
  expect(translate(plainReason('PASSED'), 'ur')).toBe('تصویر جانچ میں کامیاب');
  expect(translate(plainReason('PASSED'), 'ur')).not.toBe('جانچ کا وقت');
});

it("Setup's Checked wording is unchanged", () => {
  expect(translate('Checked', 'ur')).toBe('جانچ کا وقت');
});
