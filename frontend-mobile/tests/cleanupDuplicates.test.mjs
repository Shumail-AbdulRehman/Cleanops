import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { installMocks, setLanguage, render, allText } from './support/nativeHarness.mjs';

const React = (await import('react')).default;
const { translate } = await import('../src/i18n/translations.ts');
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
  '/queries/profile': { useStaffProfileQuery: () => ({ data: state.profile, isPending: false, isError: false, refetch: async () => {} }) },
  '/queries/history': { useProfileSummary: () => ({ data: state.summary, isPending: false, isError: false, refetch: async () => {} }) },
  '/auth/AuthContext': { useAuth: () => ({ user: { id: 2, companyId: 7, name: 'Auth Name', email: 'auth@example.invalid' }, logout: async () => {} }) },
});
const { ProfileScreen } = await import('../src/screens/profile/ProfileScreen.tsx');
const h = React.createElement;

test('StartTaskScreen has no local camera parts and imports the shared ones', () => {
  const source = readFileSync(new URL('../src/screens/StartTaskScreen.tsx', import.meta.url), 'utf8');
  for (const name of ['Viewfinder', 'CameraButton', 'BusyCard']) {
    assert.ok(!new RegExp(`function ${name}\\b`).test(source), `${name} must not be defined locally`);
  }
  assert.match(source, /import \{[^}]*CameraRoundButton[^}]*CaptureBusyCard[^}]*CaptureFrame[^}]*\} from '\.\.\/components\/PhotoCaptureControls'/);
});

test('Profile with an invalid location zone renders the Joined month from Asia/Karachi', async () => {
  setLanguage('en');
  state.profile = { id: 41, name: 'Amina Khan', email: 'amina@example.invalid', phone: null, role: 'STAFF', isActive: true,
    companyId: 7, locationId: 1, createdAt: '2026-02-28T20:00:00.000Z', updatedAt: '2026-02-28T20:00:00.000Z', shiftStart: null, shiftEnd: null };
  state.summary = { id: 41, name: 'Amina Khan', email: 'amina@example.invalid', phone: null, joinedAt: '2026-02-28T20:00:00.000Z',
    company: { name: 'Acme' }, location: { id: 1, name: 'Main', address: '1 Road', timezone: 'Not/AZone' }, usualShift: null };
  const text = allText(await render(h(ProfileScreen)));
  assert.ok(text.includes('March 2026'));
});

test('the harness t() fills placeholder values', async () => {
  installMocks({});
  const { useLanguage: mocked } = await import('../src/i18n/LanguageProvider.tsx');
  assert.equal(mocked().t('{n} of {t}', { n: 1, t: 3 }), '1 of 3');
});

test('the six unused legacy files are gone', () => {
  const files = ['Language' + 'Choice', ...['card', 'badge', 'separator', 'skeleton', 'input'].map(name => `ui/${name}`)];
  for (const file of files) {
    assert.ok(!existsSync(new URL(`../src/components/${file}.tsx`, import.meta.url)), file);
  }
});
