import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks, createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { create, act } from 'react-test-renderer';

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const directory = mkdtempSync(join(tmpdir(), 'priv-photo-controls-'));
const mocks = {
  'react-native': `{
    View:'View', Pressable:'Pressable', ActivityIndicator:'ActivityIndicator',
    StyleSheet:{create:styles=>styles, flatten:styles=>Object.assign({},...[styles].flat(Infinity))},
    Platform:{OS:'android'},
    Appearance:{getColorScheme:()=> 'light',addChangeListener:()=>({remove(){}})},
    AppState:{currentState:'active',addEventListener:()=>({remove(){}})},
    Dimensions:{get:()=>({width:360,height:800}),addEventListener:()=>({remove(){}})},
    AccessibilityInfo:{isReduceMotionEnabled:()=>Promise.resolve(false),addEventListener:()=>({remove(){}})}
  }`,
  '../i18n/LanguageProvider': '{useLanguage:()=>({t:text=>text})}',
  './ui/icon': '{Icon:"Icon"}',
  '../design/StaffText': '{StaffText:"Text"}',
  // The shutter scale runs on Reanimated; record the targets instead of animating.
  'react-native-reanimated': `{__esModule:true,default:{View:'AnimatedView'},useReducedMotion:()=>globalThis.shutterMotion.reduced,
    useSharedValue:value=>({value}),useAnimatedStyle:factory=>factory(),
    withTiming:(value,config)=>{globalThis.shutterMotion.timings.push({value,config});return value;},withRepeat:value=>value,
    Easing:{linear:()=>0,ease:()=>0,out:()=>()=>0,bezier:()=>()=>0}}`,
  'expo-haptics': `{ImpactFeedbackStyle:{Medium:'medium',Light:'light'},impactAsync:async style=>{globalThis.shutterMotion.haptics.push(style);}}`,
};
globalThis.shutterMotion = {reduced:false,timings:[],haptics:[]};
const urls = Object.fromEntries(Object.entries(mocks).map(([name, value], i) => {
  const path = join(directory, `${i}.cjs`);
  writeFileSync(path, `module.exports=${value};`);
  return [name, pathToFileURL(path).href];
}));
const hook = registerHooks({resolve(specifier, context, next) {
  return urls[specifier] ? {url:urls[specifier],shortCircuit:true} : next(specifier, context);
}});

test('native photo shutter stays circular through styling, pressing and loading', async () => {
  let renderer;
  try {
    const require = createRequire(import.meta.url);
    const native = require('react-native');
    const { interop } = require('react-native-css-interop/dist/runtime/native/native-interop.js');
    // Exercise the installed native styling runtime, not just raw JSX props.
    native.Pressable = props => interop('Pressable', [{source:'className',target:['style'],inlineProp:'style'}], props);
    const { PhotoCaptureControls } = await import('../src/components/PhotoCaptureControls.tsx');
    const { motion } = await import('../src/design/tokens.ts');
    let captures = 0;
    const props = {disabled:false,busy:false,label:'Take photo',onCapture:()=>captures++};
    await act(async () => { renderer = create(React.createElement(PhotoCaptureControls, props)); });
    const shutter = () => renderer.root.findByType('Pressable');
    // Redesign (spec 45): an 80 white face inside a 4 gap and a 4 white ring, so 96 across.
    const assertBounds = () => {
      const style = native.StyleSheet.flatten(shutter().props.style);
      assert.equal(style.width,96);
      assert.equal(style.height,96);
      assert.equal(style.flexGrow,0);
      assert.equal(style.flexShrink,0);
      assert.equal(style.borderRadius,48);
      const ring = shutter().findByType('AnimatedView');
      const ringStyle = native.StyleSheet.flatten(ring.props.style);
      assert.equal(ringStyle.width,96);
      assert.equal(ringStyle.height,96);
      assert.equal(ringStyle.borderRadius,48);
      const face = shutter().findByType('View');
      assert.equal(face.props.style.width,80);
      assert.equal(face.props.style.height,80);
      assert.equal(face.props.style.borderRadius,40);
      assert.equal(face.props.style.flex,undefined);
      return style;
    };
    const lastScale = () => native.StyleSheet.flatten(shutter().findByType('AnimatedView').props.style).transform?.[0]?.scale;
    assert.equal(assertBounds().opacity,1);
    assert.equal(shutter().props.accessibilityLabel,'Take photo');
    // Pressing scales the ring to 0.93 (not dimming) and keeps the bounds.
    await act(async () => { shutter().props.onPressIn(); });
    assert.deepEqual(globalThis.shutterMotion.timings.map(t => t.value),[motion.scale.shutter]);
    assert.equal(motion.scale.shutter,0.93);
    assert.equal(assertBounds().opacity,1);
    await act(async () => { shutter().props.onPress(); shutter().props.onPressOut(); });
    assert.equal(captures,1);
    assert.deepEqual(globalThis.shutterMotion.haptics,['medium'],'one medium haptic per press');
    assert.deepEqual(globalThis.shutterMotion.timings.map(t => t.value),[0.93,1]);
    assert.equal(assertBounds().opacity,1);
    assert.equal(lastScale(),1);
    await act(async () => { renderer.update(React.createElement(PhotoCaptureControls,{...props,busy:true})); });
    assertBounds();
    assert.equal(shutter().props.disabled,true);
    assert.equal(shutter().props.accessibilityState.busy,true);
    assert.equal(shutter().findAllByType('ActivityIndicator').length,1);
    await act(async () => { shutter().props.onPressIn(); });
    assert.equal(globalThis.shutterMotion.timings.length,2,'a busy shutter does not scale');
    await act(async () => { renderer.update(React.createElement(PhotoCaptureControls,{...props,disabled:true})); });
    assert.equal(assertBounds().opacity,0.45);
    assert.equal(shutter().props.disabled,true);
    // Reduced motion: pressing never animates.
    globalThis.shutterMotion.reduced = true;
    await act(async () => { renderer.update(React.createElement(PhotoCaptureControls,props)); });
    const before = globalThis.shutterMotion.timings.length;
    await act(async () => { shutter().props.onPressIn(); shutter().props.onPressOut(); });
    assert.equal(globalThis.shutterMotion.timings.length,before);
    assertBounds();
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    hook.deregister();
    rmSync(directory,{recursive:true,force:true});
  }
});
