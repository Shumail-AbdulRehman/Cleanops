import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { installMocks, render } from '../support/nativeHarness.mjs';
import { act } from 'react-test-renderer';

const React = (await import('react')).default;
installMocks({
  '/components/ui/icon': { Icon: props => React.createElement('Icon', props) },
  '@react-native-community/netinfo': { default: { addEventListener: () => () => {} } },
});
const { SnackbarProvider, useSnackbar } = await import('../../src/design/Feedback.tsx');
const { colors } = await import('../../src/design/tokens.ts');
const h = React.createElement;

async function shown(...args) {
  const api = {};
  const Trigger = () => { api.current = useSnackbar(); return null; };
  const r = await render(h(SnackbarProvider, null, h(Trigger)));
  await act(async () => { api.current.show(...args); });
  const bar = r.root.findAll(n => n.type === 'View' && n.props.accessibilityLiveRegion === 'polite')[0];
  const icons = bar.findAll(n => n.type === 'Icon').map(n => n.props);
  const text = bar.findAll(n => typeof n.type === 'string').flatMap(n => n.children).filter(c => typeof c === 'string').join('');
  return { icons, text, role: bar.props.accessibilityRole };
}

test('the default message keeps the yellow tick', async () => {
  const { icons } = await shown('Try again');
  assert.equal(icons.length, 1);
  assert.equal(icons[0].name, 'Check');
  assert.equal(icons[0].color, colors.yellow);
});

test('a failure shows an alert icon in surface, with no tick', async () => {
  const { icons } = await shown('Try again', undefined, 'failure');
  assert.deepEqual(icons.map(i => i.name), ['CircleAlert']);
  assert.equal(icons[0].color, colors.surface);
});

test('screen readers hear the same text and alert role in both tones', async () => {
  const a = await shown('Try again');
  const b = await shown('Try again', undefined, 'failure');
  assert.equal(a.text, b.text);
  assert.ok(b.text.includes('Try again'));
  assert.equal(b.role, 'alert');
});

test('both refresh screens pass the failure tone and use no raw colour', () => {
  for (const [file, msg] of [['HomeScreen', 'Today could not refresh. Try again.'], ['TasksScreen', 'Tasks could not refresh. Try again.']]) {
    const src = readFileSync(new URL(`../../src/screens/${file}.tsx`, import.meta.url), 'utf8');
    assert.ok(src.includes(`snackbar.show("${msg}", undefined, "failure")`), file);
  }
});
