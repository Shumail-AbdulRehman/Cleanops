import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { create, act } from 'react-test-renderer';
globalThis.React=React;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const directory=mkdtempSync(join(tmpdir(),'hygene-login-keyboard-'));
const listeners=new Map();
globalThis.loginKeyboardMocks={Keyboard:{addListener:(event,fn)=>{listeners.set(event,fn);return {remove:()=>listeners.delete(event)};}}};
const mocks={
 'react-native':'{Keyboard:globalThis.loginKeyboardMocks.Keyboard,Platform:{OS:"android"},Alert:{alert(){}},Image:"Image",KeyboardAvoidingView:"KeyboardAvoidingView",ScrollView:"ScrollView",View:"View",StyleSheet:{create:v=>v}}',
 'react-native-safe-area-context':'{useSafeAreaInsets:()=>({top:24,bottom:16})}',
 '../auth/AuthContext':'{useAuth:()=>({requestCode:async()=>{},signInWithCode:async()=>{}})}',
 '../api/client':'{changeApiServerAddress:async x=>x}',
 '../api/serverAddress':'{getServerAddress:()=>"https://example.test/api",loadServerAddress:async()=>"https://example.test/api"}',
 '../config':'{API_BASE_URL:"https://example.test/api"}',
 '../i18n/LanguageProvider':'{useLanguage:()=>({t:x=>x,isRTL:false})}',
 '../design/ActionButton':'{ActionButton:"ActionButton"}', '../design/Field':'{Field:"Field"}',
 '../design/LanguageToggle':'{LanguageToggle:"LanguageToggle"}', '../design/StaffText':'{StaffText:"StaffText"}',
 '.png':'1',
};
const urls=Object.fromEntries(Object.entries(mocks).map(([key,value],i)=>{const path=join(directory,`${i}.cjs`);writeFileSync(path,`module.exports=${value};`);return [key,pathToFileURL(path).href];}));
const hook=registerHooks({resolve(specifier,context,next){const key=specifier.endsWith('.png')?'.png':specifier;return urls[key]?{url:urls[key],shortCircuit:true}:next(specifier,context);}});
test('Android login reserves scroll space for the keyboard and keeps sign-in reachable',async()=>{
 let renderer;
 try{
  const {LoginScreen}=await import('../src/screens/LoginScreen.tsx');
  await act(async()=>{renderer=create(React.createElement(LoginScreen));});
  const scroll=()=>renderer.root.findByType('ScrollView');
  const normal=scroll().props.contentContainerStyle.paddingBottom;
  assert.equal(renderer.root.findByType('KeyboardAvoidingView').props.behavior,'height');
  assert.equal(scroll().props.style.flex,1);
  assert.equal(scroll().props.keyboardShouldPersistTaps,'handled');
  await act(async()=>listeners.get('keyboardDidShow')({endCoordinates:{height:280}}));
  assert.equal(scroll().props.contentContainerStyle.paddingBottom,normal+280);
  assert.ok(renderer.root.findAllByType('ActionButton').some(b=>b.props.label==='Send code'&&b.props.kind==='form'));
  await act(async()=>listeners.get('keyboardDidHide')());
  assert.equal(scroll().props.contentContainerStyle.paddingBottom,normal);
  await act(async()=>renderer.unmount());renderer=undefined;
  assert.equal(listeners.size,0);
 }finally{if(renderer)await act(async()=>renderer.unmount());hook.deregister();rmSync(directory,{recursive:true,force:true});}
});
