import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { create, act } from 'react-test-renderer';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const directory = mkdtempSync(join(tmpdir(), 'hygene-push-navigation-'));
const state = { user: { id: 2, companyId: 1 }, pending: null, visits: [], pushes: [], reads: [] };
globalThis.pushNavigationTest = state;
const mocks = {
  '@react-navigation/native': '{StackActions:{popTo:(...args)=>({type:"POP_TO",args})},createNavigationContainerRef:()=>({isReady:()=>true,dispatch:action=>globalThis.pushNavigationTest.visits.push(action.args),navigate:(...args)=>globalThis.pushNavigationTest.pushes.push(args)})}',
  '../auth/AuthContext': '{useAuth:()=>({user:globalThis.pushNavigationTest.user,isBootstrapping:false})}',
  './NotificationProvider': '{useNotifications:()=>({pending:globalThis.pushNavigationTest.pending,consume:()=>{globalThis.pushNavigationTest.pending=null}})}',
  './api': '{acknowledgePhoneAlert:async(id,scope)=>{globalThis.pushNavigationTest.reads.push([id,scope]);throw new Error("offline")}}',
};
const urls = Object.fromEntries(Object.entries(mocks).map(([key, value], i) => {
  const path = join(directory, `${i}.cjs`); writeFileSync(path, `module.exports=${value};`);
  return [key, pathToFileURL(path).href];
}));
const hook = registerHooks({ resolve(specifier, context, next) {
  return urls[specifier] ? { url: urls[specifier], shortCircuit: true } : next(specifier, context);
} });
test('push taps navigate directly while offline, and old-account taps cannot open work', async () => {
  let renderer;
  try {
    const { NotificationNavigation } = await import('../src/notifications/NotificationNavigation.tsx');
    for (const [kind, destination] of [['TASK_ASSIGNED', 'Tasks'], ['TASK_CHANGED', 'Tasks'], ['SHIFT_APPROACHING', 'Shift'], ['MISSING_CHECK_IN', 'Shift'], ['CHECKOUT_APPROACHING', 'Shift']]) {
      state.pending = { notificationId: 7, staffId: 2, companyId: 1, kind };
      await act(async () => { renderer = create(React.createElement(NotificationNavigation, { ready: true })); });
      assert.deepEqual(state.visits.at(-1), ['StaffTabs', { screen: destination }]);
      assert.equal(state.pushes.length, 0);
      assert.deepEqual(state.reads.at(-1), [7, '1_2']);
      assert.equal(state.pending, null);
      await act(async () => renderer.unmount()); renderer = undefined;
    }
    const count = state.visits.length;
    state.pending = { notificationId: 8, staffId: 99, companyId: 1, kind: 'TASK_ASSIGNED' };
    await act(async () => { renderer = create(React.createElement(NotificationNavigation, { ready: true })); });
    assert.equal(state.visits.length, count);
    assert.equal(state.reads.length, count);
    assert.equal(state.pending, null);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    hook.deregister(); rmSync(directory, { recursive: true, force: true });
    delete globalThis.pushNavigationTest;
  }
});
