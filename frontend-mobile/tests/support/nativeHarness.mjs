// Shared harness for React Native component tests. Import this file FIRST in a test,
// call installMocks() before importing any component, then import components dynamically.
import { registerHooks } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { translate } from '../../src/i18n/translations.ts';

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const state = {
  language: 'en',
  window: { width: 390, height: 844 },
  navigation: [],
  haptics: [],
  mocks: {},
  hook: null,
  directory: null,
};
globalThis.__nativeHarness = state;

const record = (list, name) => (...args) => { list.push({ name, args }); };
const noop = () => {};

function defaults() {
  const navigation = {
    navigate: record(state.navigation, 'navigate'),
    goBack: record(state.navigation, 'goBack'),
    replace: record(state.navigation, 'replace'),
    reset: record(state.navigation, 'reset'),
    setOptions: record(state.navigation, 'setOptions'),
    addListener: () => noop,
  };
  const haptic = name => async (...args) => { state.haptics.push({ name, args }); };
  const query = { data: undefined, isLoading: false, isError: false, error: null, refetch: async () => ({}) };
  return {
    'react-native': {
      View: 'View', Text: 'Text', ScrollView: 'ScrollView', Pressable: 'Pressable', Image: 'Image',
      Modal: 'Modal', TextInput: 'TextInput', ActivityIndicator: 'ActivityIndicator', RefreshControl: 'RefreshControl',
      StyleSheet: {
        create: value => value,
        flatten: value => (Array.isArray(value) ? Object.assign({}, ...value.flat(Infinity).filter(Boolean)) : value),
        absoluteFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
        hairlineWidth: 1,
      },
      Platform: { OS: 'android', select: map => ('android' in map ? map.android : map.default) },
      Linking: { openSettings: async () => {}, openURL: async () => {} },
      Alert: { alert: noop },
      AppState: { currentState: 'active', addEventListener: () => ({ remove: noop }) },
      BackHandler: { addEventListener: () => ({ remove: noop }) },
      AccessibilityInfo: {
        announceForAccessibility: noop, isScreenReaderEnabled: async () => false,
        isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove: noop }),
      },
      useWindowDimensions: () => ({ ...state.window, scale: 1, fontScale: 1 }),
      I18nManager: { isRTL: false, allowRTL: noop, forceRTL: noop },
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
    'react-native-reanimated': (() => {
      const Animated = { View: 'View', Text: 'Text', ScrollView: 'ScrollView', createAnimatedComponent: c => c };
      return {
        __esModule: true, default: Animated, ...Animated,
        useReducedMotion: () => false,
        useSharedValue: value => ({ value }),
        useAnimatedStyle: factory => factory(),
        withTiming: value => value, withRepeat: value => value, withDelay: (_, value) => value,
        Easing: { linear: noop, ease: noop, in: noop, out: noop, inOut: noop, bezier: () => noop },
      };
    })(),
    'expo-haptics': {
      impactAsync: haptic('impactAsync'), notificationAsync: haptic('notificationAsync'), selectionAsync: haptic('selectionAsync'),
      ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
      NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
    },
    'expo-camera': {
      CameraView: 'CameraView', useCameraPermissions: () => [{ granted: true, canAskAgain: true }, async () => ({ granted: true })],
    },
    'expo-location': {
      requestForegroundPermissionsAsync: async () => ({ status: 'granted', granted: true }),
      getForegroundPermissionsAsync: async () => ({ status: 'granted', granted: true }),
      getCurrentPositionAsync: async () => ({ coords: { latitude: 0, longitude: 0, accuracy: 5 }, timestamp: 0 }),
      Accuracy: { Balanced: 3, High: 4 },
    },
    '@react-navigation/native': {
      useNavigation: () => navigation, useIsFocused: () => true, useRoute: () => ({ params: {} }), useFocusEffect: noop,
    },
    '@tanstack/react-query': {
      useQuery: () => query, useInfiniteQuery: () => ({ ...query, fetchNextPage: noop, hasNextPage: false }),
      useQueryClient: () => ({ invalidateQueries: async () => {}, setQueryData: noop, getQueryData: noop }),
    },
    '/i18n/LanguageProvider': {
      useLanguage: () => ({
        language: state.language, isRTL: state.language === 'ur',
        t: (text, values) => translate(text, state.language, values), setLanguage: noop,
      }),
    },
    '/auth/AuthContext': {
      useAuth: () => ({ user: { id: 2, companyId: 7, name: 'Synthetic staff', email: 'staff@example.invalid' }, logout: async () => {} }),
    },
  };
}

// Overrides replace a default module's exports key by key (plain objects are merged over the default),
// or add a module. Keys starting with "/" match any import whose path ends with that suffix.
export function installMocks(overrides = {}) {
  if (state.hook) state.hook.deregister();
  const base = defaults();
  const merged = { ...base };
  for (const [name, value] of Object.entries(overrides)) {
    merged[name] = name in base && value && typeof value === 'object' && !Array.isArray(value) ? { ...base[name], ...value } : value;
  }
  state.mocks = merged;
  if (!state.directory) {
    state.directory = mkdtempSync(join(tmpdir(), 'native-harness-'));
    process.on('exit', () => { try { rmSync(state.directory, { recursive: true, force: true }); } catch { /* already gone */ } });
  }
  const urls = {};
  Object.keys(merged).forEach((name, index) => {
    const path = join(state.directory, `${index}-${Date.now()}.mjs`);
    const exports = Object.keys(merged[name] ?? {}).filter(key => /^[A-Za-z_$][\w$]*$/.test(key) && key !== 'default');
    const source = [`const m = globalThis.__nativeHarness.mocks[${JSON.stringify(name)}];`, 'export default m.default ?? m;',
      ...exports.map(key => `export const ${key} = m[${JSON.stringify(key)}];`)].join('\n');
    writeFileSync(path, source);
    urls[name] = pathToFileURL(path).href;
  });
  state.hook = registerHooks({
    resolve(specifier, context, next) {
      const plain = specifier.replace(/\.tsx?$/, '');
      const key = Object.keys(urls).find(name => specifier === name || (name.startsWith('/') && plain.endsWith(name)));
      return key ? { url: urls[key], shortCircuit: true } : next(specifier, context);
    },
  });
}

export function setLanguage(language) { state.language = language; }
export function setWindowSize(width, height = 844) { state.window = { width, height }; }
export function navigationCalls() { return state.navigation; }
export function hapticsCalls() { return state.haptics; }
export function resetCalls() { state.navigation.length = 0; state.haptics.length = 0; }

export async function render(element, { fontsReady = true } = {}) {
  const { NativeFontsReady } = await import('../../src/fonts.ts');
  let renderer;
  await act(async () => { renderer = create(React.createElement(NativeFontsReady.Provider, { value: fontsReady }, element)); });
  return renderer;
}

function collectText(node, out) {
  if (node == null) return;
  if (typeof node === 'string') { out.push(node); return; }
  if (Array.isArray(node)) { node.forEach(child => collectText(child, out)); return; }
  collectText(node.children, out);
}
export function allText(renderer) { const out = []; collectText(renderer.toJSON(), out); return out.join(' '); }

function instanceText(instance) {
  return instance.children.map(child => (typeof child === 'string' ? child : instanceText(child))).join(' ').trim();
}
export function findPressable(renderer, label) {
  return renderer.root.findAll(node => node.type === 'Pressable' && typeof node.props.onPress === 'function'
    && (node.props.accessibilityLabel === label || instanceText(node) === label))[0];
}
export async function press(node) {
  if (!node) throw new Error('press: node not found');
  await act(async () => { node.props.onPress(); });
}
