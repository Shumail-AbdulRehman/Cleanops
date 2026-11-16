import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { translate } from '../src/i18n/translations.ts';

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let language = 'en';
globalThis.nativeComposition = {
  language: () => ({ language, isRTL: language === 'ur', t: text => translate(text, language) }),
  auth: () => ({ user: { id: 2, companyId: 7, name: 'Synthetic staff', email: 'staff@example.invalid' }, logout: async () => {} }),
};
const mocks = {
  'react-native': '{View:"View",ScrollView:"ScrollView",Text:"NativeText",Platform:{OS:"android"},StyleSheet:{flatten:value=>Array.isArray(value)?Object.assign({},...value):value},Linking:{openSettings:async()=>{}},Alert:{alert(){}}}',
  'react-native-safe-area-context': '{useSafeAreaInsets:()=>({top:0,bottom:0})}',
  '/i18n/LanguageProvider': '{useLanguage:globalThis.nativeComposition.language}',
  '/auth/AuthContext': '{useAuth:globalThis.nativeComposition.auth}',
};
const directory = mkdtempSync(join(tmpdir(), 'native-v5-composition-'));
const urls = Object.fromEntries(Object.entries(mocks).map(([name, expression], index) => {
  const path = join(directory, index + '.cjs'); writeFileSync(path, `module.exports=${expression};`);
  return [name, pathToFileURL(path).href];
}));
const hook = registerHooks({ resolve(specifier, context, next) {
  const plain = specifier.replace(/\.tsx?$/, '');
  const key = Object.keys(urls).find(name => specifier === name || name.startsWith('/') && plain.endsWith(name));
  return key ? { url: urls[key], shortCircuit: true } : next(specifier, context);
} });
const { Text } = await import('../src/components/ui/text.tsx');
const { NativeFontsReady } = await import('../src/fonts.ts');
async function mount(node, ready = true) {
  let renderer;
  await act(async () => { renderer = create(React.createElement(NativeFontsReady.Provider, { value: ready }, node)); });
  return renderer;
}
async function close(renderer) { await act(async () => renderer.unmount()); }

test('loaded type follows language and emphasis while system scaling and font-failure fallback remain usable', async () => {
  language = 'en'; const node = React.createElement(Text, { className: 'text-xl font-semibold' }, 'Your shift');
  const renderer = await mount(node);
  try {
    let text = renderer.root.findByType('NativeText');
    assert.equal(text.props.style[0].fontFamily, 'HygeneInterSemiBold');
    assert.notEqual(text.props.allowFontScaling, false);
    language = 'ur';
    await act(async () => renderer.update(React.createElement(NativeFontsReady.Provider, { value: true }, React.createElement(Text, { className: 'text-xl font-semibold' }, 'Your shift'))));
    text = renderer.root.findByType('NativeText');
    assert.equal(text.props.style[0].fontFamily, 'HygeneArabicBold');
    assert.equal(text.props.children, 'آپ کی شفٹ');
    await act(async () => renderer.update(React.createElement(NativeFontsReady.Provider, { value: true }, React.createElement(Text, { className: 'font-semibold' }, 'Hygene Ops'))));
    assert.equal(renderer.root.findByType('NativeText').props.style[0].fontFamily, 'HygeneInterSemiBold');
    await act(async () => renderer.update(React.createElement(NativeFontsReady.Provider, { value: false }, React.createElement(Text, null, 'Your shift'))));
    assert.equal(renderer.root.findByType('NativeText').props.style[0].fontFamily, 'sans-serif');
  } finally { await close(renderer); language = 'en'; }
});

test.after(() => { hook.deregister(); rmSync(directory, { recursive: true, force: true }); });
