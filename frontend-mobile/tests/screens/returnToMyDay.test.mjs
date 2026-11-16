// Spec 54: going back to My day must return to the one StaffTabs (popTo), never push a second tab navigator.
// Behaviour of "Check in" and "Next task" is proven where those screens are already mounted:
// tests/screens/taskDetail.test.mjs (popTo, no navigate) and tests/screens/photoCapture.test.mjs (popTo, no navigate).
// Here: the phone-alert path by behaviour, and a source guard on all three call sites.
import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { create, act } from 'react-test-renderer';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const directory = mkdtempSync(join(tmpdir(), 'return-to-my-day-'));
const state = { user: { id: 2, companyId: 1 }, pending: null, dispatched: [], navigated: [], pushed: [] };
globalThis.returnToMyDayTest = state;
const mocks = {
  '@react-navigation/native': `{StackActions:{popTo:(...args)=>({type:'POP_TO',args})},createNavigationContainerRef:()=>({isReady:()=>true,dispatch:a=>globalThis.returnToMyDayTest.dispatched.push(a),navigate:(...a)=>globalThis.returnToMyDayTest.navigated.push(a),push:(...a)=>globalThis.returnToMyDayTest.pushed.push(a)})}`,
  '../auth/AuthContext': '{useAuth:()=>({user:globalThis.returnToMyDayTest.user,isBootstrapping:false})}',
  './NotificationProvider': '{useNotifications:()=>({pending:globalThis.returnToMyDayTest.pending,consume:()=>{globalThis.returnToMyDayTest.pending=null}})}',
  './api': '{acknowledgePhoneAlert:async()=>{}}',
};
const urls = Object.fromEntries(Object.entries(mocks).map(([key, value], i) => {
  const path = join(directory, `${i}.cjs`); writeFileSync(path, `module.exports=${value};`);
  return [key, pathToFileURL(path).href];
}));
const hook = registerHooks({ resolve(specifier, context, next) {
  return urls[specifier] ? { url: urls[specifier], shortCircuit: true } : next(specifier, context);
} });

test.after(() => { hook.deregister(); rmSync(directory, { recursive: true, force: true }); delete globalThis.returnToMyDayTest; });

test('a pending phone alert pops to the existing StaffTabs on the right tab and never navigates or pushes', async () => {
  const { NotificationNavigation } = await import('../../src/notifications/NotificationNavigation.tsx');
  for (const [kind, tab] of [['TASK_ASSIGNED', 'Tasks'], ['SHIFT_APPROACHING', 'Shift']]) {
    state.pending = { notificationId: 7, staffId: 2, companyId: 1, kind };
    let renderer;
    await act(async () => { renderer = create(React.createElement(NotificationNavigation, { ready: true })); });
    assert.deepEqual(state.dispatched.at(-1), { type: 'POP_TO', args: ['StaffTabs', { screen: tab }] });
    await act(async () => renderer.unmount());
  }
  assert.equal(state.dispatched.length, 2);
  assert.deepEqual(state.navigated, []);
  assert.deepEqual(state.pushed, []);
});

const read = path => readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8');
test('the three call sites use popTo with the My day tab and none navigates or pushes StaffTabs', () => {
  const detail = read('screens/task/TaskDetailScreen.tsx');
  const verification = read('screens/verification/VerificationScreen.tsx');
  const alerts = read('notifications/NotificationNavigation.tsx');
  assert.match(detail, /navigation\.popTo\(stackRoutes\.staffTabs,\s*\{\s*screen:\s*tabRoutes\.myDay\s*\}\)/);
  assert.match(verification, /navigation\.popTo\(stackRoutes\.staffTabs,\s*\{\s*screen:\s*tabRoutes\.myDay\s*\}\)/);
  assert.match(alerts, /StackActions\.popTo\(\s*"StaffTabs"/);
  for (const source of [detail, verification, alerts]) {
    assert.doesNotMatch(source, /(navigate|push)\(\s*(stackRoutes\.staffTabs|["']StaffTabs["'])/);
  }
});
