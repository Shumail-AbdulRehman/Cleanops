import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, render } from '../support/nativeHarness.mjs';

const React = (await import('react')).default;
const { translate } = await import('../../src/i18n/translations.ts');
const h = React.createElement;

// Own useLanguage: its t() fills placeholder values (the shared harness t() does not).
const useLanguage = () => {
  const language = globalThis.__nativeHarness.language;
  return { language, isRTL: language === 'ur', t: (text, values) => translate(text, language, values), setLanguage() {} };
};

const state = { tasks: [], counts: undefined, calls: [], mounted: [] };
const navigator = {
  Navigator: ({ children }) => h('TabNavigator', null, children),
  // The screen component is deliberately not rendered: Tasks is never mounted.
  Screen: ({ name, options }) => h('TabScreen', { name, options }),
};
installMocks({
  '@react-navigation/bottom-tabs': { createBottomTabNavigator: () => navigator },
  '/components/ui/icon': { Icon: props => h('Icon', props) },
  '/i18n/LanguageProvider': { useLanguage },
  '/auth/AuthContext': { useAuth: () => ({ user: { id: 2 } }) },
  '/queries/staff': {
    useTodaysTasksQuery: (staffId, enabled) => {
      state.calls.push({ staffId, enabled });
      return { data: state.tasks, counts: state.counts };
    },
  },
  '/screens/HomeScreen': { HomeScreen: () => null },
  '/screens/TasksScreen': { TasksScreen: () => { state.mounted.push('Tasks'); return null; } },
  '/screens/profile/ProfileScreen': { ProfileScreen: () => null },
  '/screens/history/HistoryScreen': { HistoryScreen: () => null },
});
const { StaffTabs } = await import('../../src/navigation/StaffTabs.tsx');
const { colors } = await import('../../src/design/tokens.ts');

const task = (id, extra = {}) => ({
  id, title: `Area ${id}`, areaNameSnapshot: `Area ${id}`, status: 'PENDING', date: '2026-11-11',
  shiftStart: '2026-11-11T09:00:00.000Z', shiftEnd: '2026-11-11T10:00:00.000Z',
  startedAt: null, completedAt: null, proofImageUrls: [], location: { id: 1, name: 'HQ', timezone: 'UTC' }, ...extra,
});
const tasksOptions = r => r.root.findAll(n => n.type === 'TabScreen' && n.props.name === 'Tasks')[0].props.options;
const otherOptions = r => r.root.findAll(n => n.type === 'TabScreen' && n.props.name !== 'Tasks').map(n => n.props.options);

test.beforeEach(() => { Object.assign(state, { tasks: [], counts: undefined, calls: [], mounted: [] }); setLanguage('en'); });

for (const language of ['en', 'ur']) {
  test(`[${language}] yellow badge 2 when one of two open tasks needs the person, Tasks never mounted`, async () => {
    setLanguage(language);
    state.tasks = [task(1, { verificationState: 'REWORK_REQUIRED' }), task(2)];
    const r = await render(h(StaffTabs));
    assert.equal(tasksOptions(r).tabBarBadge, 2);
    assert.deepEqual(tasksOptions(r).tabBarBadgeStyle, { backgroundColor: colors.yellow, color: colors.ink });
    assert.deepEqual(state.mounted, []);
  });

  test(`[${language}] blue badge 9 from counts`, async () => {
    setLanguage(language);
    state.tasks = [task(2)];
    state.counts = { total: 9, submitted: 0, pending: 9, inProgress: 0 };
    const r = await render(h(StaffTabs));
    assert.equal(tasksOptions(r).tabBarBadge, 9);
    assert.deepEqual(tasksOptions(r).tabBarBadgeStyle, { backgroundColor: colors.blue, color: colors.surface });
  });

  test(`[${language}] no badge at 0`, async () => {
    setLanguage(language);
    state.tasks = [];
    const r = await render(h(StaffTabs));
    assert.equal(tasksOptions(r).tabBarBadge, undefined);
  });
}

test('other tabs carry no badge', async () => {
  state.tasks = [task(1)];
  const r = await render(h(StaffTabs));
  assert.ok(otherOptions(r).every(o => o.tabBarBadge === undefined));
});

test('the tab-level read starts no fetch and no poll: the query is observed with enabled = false', async () => {
  state.tasks = [task(1)];
  await render(h(StaffTabs));
  assert.ok(state.calls.length > 0);
  assert.ok(state.calls.every(c => c.enabled === false && c.staffId === 2));
});
