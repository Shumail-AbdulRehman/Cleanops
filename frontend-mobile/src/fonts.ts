import { createContext } from 'react';
import type { FontFamilyKey } from './design/tokens';

/** Font loading never gates authentication, recovery or the staff workflow. */
export const NativeFontsReady = createContext(false);

/**
 * Metro resolves each `require` to an asset id at bundle time. Plain Node (unit tests that import this module)
 * cannot parse font binaries, so a failed load yields 0; the bundler never reaches that branch.
 */
function asset(load: () => number): number {
  try {
    return load();
  } catch {
    return 0;
  }
}

/** Every font registered with `useFonts` at app start. The first four names are used by the legacy `Text`. */
export const staffFonts = {
  HygeneInter: asset(() => require('../assets/fonts/Inter-Regular.otf')),
  HygeneInterSemiBold: asset(() => require('../assets/fonts/Inter-SemiBold.otf')),
  HygeneArabic: asset(() => require('../assets/fonts/NotoSansArabic-Regular.ttf')),
  HygeneArabicBold: asset(() => require('../assets/fonts/NotoSansArabic-Bold.ttf')),
  HygeneInterBold: asset(() => require('../assets/fonts/Inter-Bold.otf')),
  HygeneInterExtraBold: asset(() => require('../assets/fonts/Inter-ExtraBold.otf')),
  HygeneManropeBold: asset(() => require('../assets/fonts/Manrope-Bold.ttf')),
  HygeneManropeExtraBold: asset(() => require('../assets/fonts/Manrope-ExtraBold.ttf')),
};

export function nativeFontFamily(language: 'en' | 'ur', emphasized: boolean) {
  return language === 'ur'
    ? emphasized ? 'HygeneArabicBold' : 'HygeneArabic'
    : emphasized ? 'HygeneInterSemiBold' : 'HygeneInter';
}

const englishFamilies: Record<FontFamilyKey, string> = {
  body: 'HygeneInter',
  bodySemi: 'HygeneInterSemiBold',
  bodyBold: 'HygeneInterBold',
  bodyExtra: 'HygeneInterExtraBold',
  title: 'HygeneManropeExtraBold',
  titleBold: 'HygeneManropeBold',
  urdu: 'HygeneArabic',
  urduBold: 'HygeneArabicBold',
};

const regularKeys: ReadonlySet<FontFamilyKey> = new Set<FontFamilyKey>(['body', 'urdu']);

function platformOS(): string {
  try {
    // Loaded lazily so this module stays importable in plain Node tests.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native').Platform.OS;
  } catch {
    return 'web';
  }
}

/** System font used when the bundled fonts have not loaded; same values the legacy `Text` uses. */
export function fallbackFontFamily(os: string = platformOS()): string {
  return os === 'web' ? 'system-ui, -apple-system, sans-serif' : os === 'android' ? 'sans-serif' : 'System';
}

/** The registered font family for a role key in a language, or the system fallback until fonts are ready. */
export function fontFor(familyKey: FontFamilyKey, language: 'en' | 'ur', fontsReady: boolean, os?: string): string {
  if (!fontsReady) return fallbackFontFamily(os);
  if (language === 'ur') return regularKeys.has(familyKey) ? 'HygeneArabic' : 'HygeneArabicBold';
  return englishFamilies[familyKey];
}

/** Latin letters and no Arabic script: such a string keeps the Latin face even in Urdu mode. */
export function isLatinOnly(text: string): boolean {
  return /[A-Za-z]/.test(text) && !/[؀-ۿݐ-ݿࢠ-ࣿ]/.test(text);
}
