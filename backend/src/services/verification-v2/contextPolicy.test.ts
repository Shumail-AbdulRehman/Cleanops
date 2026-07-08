import {describe,it,expect} from 'vitest';
import {captureContextPolicy,CURRENT_CONTEXT_KEYS,requiredContextKeys} from './contextPolicy.js';

describe('immutable capture context policy',()=>{
 it('requires only task items for new sessions',()=>{
  expect(requiredContextKeys({captureContextPolicy:captureContextPolicy(CURRENT_CONTEXT_KEYS)})).toEqual([]);
 });
 it('preserves both obligations for legacy or malformed sessions',()=>{
  for(const locationCheck of [null,{}, {captureContextPolicy:{version:1,requiredKeys:[]}}, {captureContextPolicy:{version:1,requiredKeys:['LAYOUT']}}, {captureContextPolicy:{version:2,requiredKeys:['ENTRANCE']}}])
   expect(requiredContextKeys(locationCheck)).toEqual(['ENTRANCE','LAYOUT']);
 });
 it('snapshots inherited keys without sharing mutable arrays',()=>{
  const keys=requiredContextKeys({});const policy=captureContextPolicy(keys);keys.pop();
  expect(requiredContextKeys({captureContextPolicy:policy})).toEqual(['ENTRANCE','LAYOUT']);
 });
});
