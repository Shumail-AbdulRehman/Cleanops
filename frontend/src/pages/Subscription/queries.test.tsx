import type { ReactNode } from 'react';
import { act,renderHook } from '@testing-library/react';
import { QueryClient,QueryClientProvider,focusManager,onlineManager } from '@tanstack/react-query';
import { beforeEach,afterEach,expect,it,vi } from 'vitest';
import { useBillingLifecycle,useBillingCatalog,useSubscription,billingLifecycleKey,billingCatalogKey } from './queries';
const m=vi.hoisted(()=>({get:vi.fn(),post:vi.fn(),user:{role:'ADMIN',companyId:42,id:7} as {role:string;companyId:number;id:number}|null}));
vi.mock('@/hooks/useAuth',()=>({default:()=>({user:m.user})}));
vi.mock('@/api/client',()=>({client:{get:m.get,post:m.post}}));
function lifecycle(){return {company:{id:42,name:'Fixture',plan:'PRO',isActive:true,operationalStatus:'ACTIVE'},usage:{locations:1,staff:2,managers:1},limits:{locations:5,staff:25,managers:3},subscription:null,reconciliationRequired:true,billingConfigured:true,ownerVerified:false,providerState:'AWAITING_PROVIDER',portalAvailable:false,checkoutAvailable:false,workspaceAccessAllowed:false,checkoutReadiness:'RECONCILIATION_PENDING'};}
const clients:QueryClient[]=[];
function mount<T>(hook:()=>T){
 const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});clients.push(client);
 const wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
 return {client,...renderHook(hook,{wrapper})};
}
async function tick(ms=1){await act(async()=>{await vi.advanceTimersByTimeAsync(ms);});await act(async()=>{await vi.advanceTimersByTimeAsync(1);});}
beforeEach(()=>{
 vi.useFakeTimers();vi.resetAllMocks();m.user={role:'ADMIN',companyId:42,id:7};
 focusManager.setFocused(true);onlineManager.setOnline(true);
 m.get.mockResolvedValue({data:{data:lifecycle()}});
});
afterEach(()=>{clients.forEach(c=>c.clear());clients.length=0;vi.useRealTimers();focusManager.setFocused(undefined);onlineManager.setOnline(true);});
it('leaves polling to the confirmation controller and supports explicit recovery',async()=>{
 const h=mount(()=>useBillingLifecycle());await tick();await tick(240000);expect(m.get).toHaveBeenCalledOnce();
 await act(async()=>{await h.result.current.refetch();});await tick();expect(m.get).toHaveBeenCalledTimes(2);h.unmount();
});
it('keeps stale facts after a failed read and recovers only on a new read',async()=>{
 const h=mount(()=>useBillingLifecycle());await tick();
 m.get.mockRejectedValueOnce({response:{status:503}});await act(async()=>{await h.result.current.refetch();});await tick();
 expect(h.result.current.isError).toBe(true);expect(h.result.current.data?.company.id).toBe(42);
 await tick(240000);expect(m.get).toHaveBeenCalledTimes(2);
 await act(async()=>{await h.result.current.refetch();});await tick();expect(h.result.current.isError).toBe(false);h.unmount();
});
it.each([401,403])('stops denied %s polling/focus/reconnect and allows manual auth recovery',async(status)=>{
 m.get.mockRejectedValue({response:{status}});const h=mount(()=>useBillingLifecycle());await tick();
 await tick(200000);expect(m.get).toHaveBeenCalledOnce();
 act(()=>focusManager.setFocused(false));act(()=>focusManager.setFocused(true));act(()=>onlineManager.setOnline(false));act(()=>onlineManager.setOnline(true));await tick();expect(m.get).toHaveBeenCalledOnce();
 m.get.mockResolvedValue({data:{data:lifecycle()}});await act(async()=>{await h.result.current.refetch();});await tick();expect(h.result.current.data?.company.id).toBe(42);h.unmount();
});
it('focus and reconnect refresh current owner reads without a checkout mutation',async()=>{
 const h=mount(()=>useBillingLifecycle());await tick();
 act(()=>focusManager.setFocused(false));act(()=>focusManager.setFocused(true));await tick();expect(m.get).toHaveBeenCalledTimes(2);
 act(()=>onlineManager.setOnline(false));act(()=>onlineManager.setOnline(true));await tick();expect(m.get).toHaveBeenCalledTimes(3);expect(m.post).not.toHaveBeenCalled();h.unmount();
});
it.each(['reconciliation','linked'] as const)('catalog remains readable during %s without enabling purchase',async(mode)=>{
 const facts={...lifecycle(),providerState:mode==='linked'?'MIRRORED':'AWAITING_PROVIDER'};
 m.get.mockImplementation(async(url)=>({data:{data:url.endsWith('/catalog')?[]:facts}}));
 const h=mount(()=>({life:useBillingLifecycle(),catalog:useBillingCatalog()}));await tick();
 expect(h.result.current.catalog.data).toEqual([]);expect(h.result.current.life.data?.checkoutAvailable).toBe(false);expect(m.post).not.toHaveBeenCalled();h.unmount();
});
it('owner switch aborts old work, removes former private keys, and rejects late results',async()=>{
 let resolve!:(value:unknown)=>void;let oldSignal:AbortSignal|undefined;
 m.get.mockImplementationOnce(async(_url,{signal})=>{oldSignal=signal;return new Promise(r=>{resolve=r;});});
 const h=mount(()=>useBillingLifecycle());await tick();
 h.client.setQueryData(billingCatalogKey(42,7),[{private:'old'}]);
 m.user={role:'ADMIN',companyId:55,id:9};m.get.mockResolvedValue({data:{data:{...lifecycle(),company:{...lifecycle().company,id:55}}}});
 h.rerender();await tick();expect(oldSignal?.aborted).toBe(true);
 await act(async()=>resolve({data:{data:lifecycle()}}));await tick();
 expect(h.result.current.data?.company.id).toBe(55);expect(h.result.current.dataOwner).toEqual({companyId:55,ownerId:9});
 expect(h.client.getQueryData(billingLifecycleKey(42,7))).toBeUndefined();expect(h.client.getQueryData(billingCatalogKey(42,7))).toBeUndefined();h.unmount();
});
it('foreign company response cannot enter the current lifecycle cache',async()=>{
 m.get.mockResolvedValue({data:{data:{...lifecycle(),company:{...lifecycle().company,id:99}}}});const h=mount(()=>useBillingLifecycle());await tick();
 expect(h.result.current.isError).toBe(true);expect(h.result.current.data).toBeUndefined();h.unmount();
});
it('signout clears private owner keys and cannot poll late results',async()=>{
 const h=mount(()=>useBillingLifecycle());await tick();m.user=null;h.rerender();await tick();
 expect(h.result.current.data).toBeUndefined();expect(h.client.getQueryData(billingLifecycleKey(42,7))).toBeUndefined();const calls=m.get.mock.calls.length;await tick(30000);expect(m.get).toHaveBeenCalledTimes(calls);h.unmount();
});
it('legacy plan summary uses company/owner keys and API-supplied availablePlans',async()=>{
 const plans=[{code:'PRO',limits:{locations:17,staff:71,managers:4}}];m.get.mockResolvedValue({data:{data:{company:{id:42,subscriptionStatus:'ACTIVE'},availablePlans:plans}}});
 const h=mount(()=>useSubscription());await tick();expect(h.result.current.data?.availablePlans).toEqual(plans);expect(h.client.getQueryData(['subscription',42,7])).toBeDefined();h.unmount();
});
it('manual billing refresh invalidates only the current owner catalog',async()=>{
 const h=mount(()=>({life:useBillingLifecycle(),catalog:useBillingCatalog()}));
 m.get.mockImplementation(async(url)=>({data:{data:url.endsWith('/catalog')?[]:lifecycle()}}));
 await tick();
 h.client.setQueryData(billingCatalogKey(55,9),['foreign']);
 const before=m.get.mock.calls.filter(([url])=>url.endsWith('/catalog')).length;
 await act(async()=>{await h.result.current.life.refreshBilling();});await tick();
 expect(m.get.mock.calls.filter(([url])=>url.endsWith('/catalog')).length).toBe(before+1);
 expect(h.client.getQueryData(billingCatalogKey(55,9))).toEqual(['foreign']);h.unmount();
});
it('removing the last observer aborts its pending request and leaves no private record',async()=>{
 let signal:AbortSignal|undefined;
 m.get.mockImplementation(async(_url,config)=>{signal=config.signal;return new Promise(()=>{});});
 const h=mount(()=>useBillingLifecycle());await tick();h.unmount();await tick();
 expect(signal?.aborted).toBe(true);expect(h.client.getQueryData(billingLifecycleKey(42,7))).toBeUndefined();
});
it('does not automatically poll a resolved existing subscription',async()=>{
 m.get.mockResolvedValue({data:{data:{...lifecycle(),reconciliationRequired:false,providerState:'MIRRORED',checkoutReadiness:'LINKED_SUBSCRIPTION'}}});
 const h=mount(()=>useBillingLifecycle());await tick();await tick(180000);expect(m.get).toHaveBeenCalledOnce();h.unmount();
});
it('a malformed catalog has an explicit read error without falling back to invented plans',async()=>{
 m.get.mockResolvedValue({data:{data:[{plan:'FREE',amount:'1'}]}});const h=mount(()=>useBillingCatalog());await tick();
 expect(h.result.current.isError).toBe(true);expect(h.result.current.data).toBeUndefined();expect(m.post).not.toHaveBeenCalled();h.unmount();
});
it('a saved draft does not start a second confirmation loop',async()=>{
 const draft={...lifecycle(),reconciliationRequired:false,checkoutReadiness:'READY',checkoutAvailable:true,checkoutResume:{plan:'PRO',interval:'year',transactionId:'txn_'+'a'.repeat(26)}};
 m.get.mockResolvedValue({data:{data:draft}});const h=mount(()=>useBillingLifecycle());await tick();
 await tick(240000);expect(m.get).toHaveBeenCalledOnce();expect(m.post).not.toHaveBeenCalled();h.unmount();
});
