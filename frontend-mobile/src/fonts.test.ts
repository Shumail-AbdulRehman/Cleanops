import assert from 'node:assert/strict';
import test from 'node:test';
import type { FontFamilyKey } from './design/tokens';

const { fallbackFontFamily, fontFor, isLatinOnly, nativeFontFamily, staffFonts } = require('./fonts') as typeof import('./fonts');

const keys: FontFamilyKey[] = ['body', 'bodySemi', 'bodyBold', 'bodyExtra', 'title', 'titleBold', 'urdu', 'urduBold'];

test('English roles map to the registered names', () => {
  const expected: Record<FontFamilyKey, string> = {
    body: 'HygeneInter', bodySemi: 'HygeneInterSemiBold', bodyBold: 'HygeneInterBold', bodyExtra: 'HygeneInterExtraBold',
    title: 'HygeneManropeExtraBold', titleBold: 'HygeneManropeBold', urdu: 'HygeneArabic', urduBold: 'HygeneArabicBold',
  };
  for (const k of keys) assert.equal(fontFor(k, 'en', true), expected[k], k);
});

test('Urdu maps regular to Noto Regular and everything heavier to Noto Bold', () => {
  for (const k of keys) {
    assert.equal(fontFor(k, 'ur', true), k === 'body' || k === 'urdu' ? 'HygeneArabic' : 'HygeneArabicBold', k);
  }
});

test('every returned family is registered', () => {
  for (const lang of ['en', 'ur'] as const) for (const k of keys) assert.ok(fontFor(k, lang, true) in staffFonts, `${lang} ${k}`);
});

test('not ready returns the system fallback', () => {
  assert.equal(fontFor('title', 'en', false, 'ios'), 'System');
  assert.equal(fontFor('urduBold', 'ur', false, 'android'), 'sans-serif');
  assert.equal(fontFor('body', 'en', false, 'web'), 'system-ui, -apple-system, sans-serif');
  assert.equal(fallbackFontFamily('ios'), 'System');
});

test('nativeFontFamily is unchanged', () => {
  assert.equal(nativeFontFamily('en', false), 'HygeneInter');
  assert.equal(nativeFontFamily('en', true), 'HygeneInterSemiBold');
  assert.equal(nativeFontFamily('ur', false), 'HygeneArabic');
  assert.equal(nativeFontFamily('ur', true), 'HygeneArabicBold');
});

test('isLatinOnly', () => {
  assert.equal(isLatinOnly('Lobby and reception'), true);
  assert.equal(isLatinOnly('اگلا کام'), false);
  assert.equal(isLatinOnly('Task اگلا'), false);
  assert.equal(isLatinOnly('12:30'), false);
});
