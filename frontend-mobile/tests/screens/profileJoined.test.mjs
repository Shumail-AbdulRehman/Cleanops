import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, render, allText, resetCalls } from '../support/nativeHarness.mjs';

const React = (await import('react')).default;
const { translate } = await import('../../src/i18n/translations.ts');
const useLanguage = () => {
  const language = globalThis.__nativeHarness.language;
  return { language, isRTL: language === 'ur', t: (text, values) => translate(text, language, values), setLanguage() {} };
};
const state = { profile: undefined, summary: undefined };
installMocks({
  '/components/ui/icon': { Icon: props => React.createElement('Icon', props) },
  '/i18n/LanguageProvider': { useLanguage },
  '@react-native-community/netinfo': { default: { addEventListener: () => () => {} } },
  'expo-application': { nativeApplicationVersion: '1.4.2' },
  '/queries/profile': {
    useStaffProfileQuery: () => ({ data: state.profile, isPending: false, isError: false, refetch: async () => {} }),
  },
  '/queries/history': {
    useProfileSummary: () => ({ data: state.summary, isPending: state.summary === undefined, isError: false, refetch: async () => {} }),
  },
  '/auth/AuthContext': {
    useAuth: () => ({ user: { id: 2, companyId: 7, name: 'Auth Name', email: 'auth@example.invalid' }, logout: async () => {} }),
  },
});
const { ProfileScreen } = await import('../../src/screens/profile/ProfileScreen.tsx');
const h = React.createElement;

const profile = (createdAt) => ({
  id: 41, name: 'Amina Khan', email: 'amina@example.invalid', phone: null, role: 'STAFF', isActive: true,
  companyId: 7, locationId: 1, createdAt, updatedAt: '2026-01-01T00:00:00.000Z', shiftStart: null, shiftEnd: null,
});
const summary = timezone => ({
  id: 41, name: 'Amina Khan', email: 'amina@example.invalid', phone: null, joinedAt: '2026-02-28T20:00:00.000Z',
  company: { name: 'Acme' }, location: timezone ? { id: 1, name: 'Main', address: '1 Road', timezone } : null, usualShift: null,
});

test.beforeEach(() => {
  state.profile = profile('2026-02-28T20:00:00.000Z');
  state.summary = summary('Asia/Karachi');
  resetCalls();
  setLanguage('en');
});

test('joined month uses the location time zone: 20:00 UTC on 28 Feb is 1 March in Karachi', async () => {
  const text = allText(await render(h(ProfileScreen)));
  assert.ok(text.includes('March 2026'));
  assert.ok(!text.includes('February 2026'));
});

test('joined month falls back to Asia/Karachi while the summary has not loaded', async () => {
  state.summary = undefined;
  const text = allText(await render(h(ProfileScreen)));
  assert.ok(text.includes('March 2026'));
  assert.ok(!text.includes('February 2026'));
});

test('joined month falls back to Asia/Karachi when the summary has no location', async () => {
  state.summary = summary(null);
  const text = allText(await render(h(ProfileScreen)));
  assert.ok(text.includes('March 2026'));
});

test('joined month uses the summary location zone, not Karachi', async () => {
  state.summary = summary('America/New_York');
  const text = allText(await render(h(ProfileScreen)));
  assert.ok(text.includes('February 2026'));
  assert.ok(!text.includes('March 2026'));
});

test('a mid-month join keeps its month', async () => {
  state.profile = profile('2026-02-14T08:00:00.000Z');
  const text = allText(await render(h(ProfileScreen)));
  assert.ok(text.includes('February 2026'));
});

test('joined month shows the Urdu month name in Urdu', async () => {
  setLanguage('ur');
  const text = allText(await render(h(ProfileScreen)));
  assert.ok(text.includes('مارچ 2026'));
});
