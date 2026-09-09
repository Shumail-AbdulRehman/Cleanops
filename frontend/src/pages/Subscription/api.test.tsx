import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { InternalAxiosRequestConfig } from 'axios';
const m=vi.hoisted(()=>({get:vi.fn(),post:vi.fn()}));
vi.mock('@/api/client',()=>({client:m}));
import { getBillingLifecycle,getBillingCatalog,prepareBillingCheckout,prepareBillingPortal,getSubscription,getPricingContext,createCustomerPortalSession,confirmBillingCheckout,reconcileBillingCheckout } from './api';
const transactionId='txn_'+'a'.repeat(26);
const lifecycle={company:{id:42,name:'Fixture',plan:'PRO',isActive:true,operationalStatus:'ACTIVE'},usage:{locations:1,staff:2,managers:1},limits:{locations:5,staff:25,managers:3},subscription:null,reconciliationRequired:false,billingConfigured:true,ownerVerified:false,providerState:'NOT_LINKED',portalAvailable:false,checkoutAvailable:true};
beforeEach(()=>vi.resetAllMocks());
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
it('validates lifecycle and normalizes legacy facts without inventing permission',async()=>{
 m.get.mockResolvedValue({data:{data:lifecycle}});
 expect(await getBillingLifecycle(undefined,42)).toMatchObject({workspaceAccessAllowed:false,checkoutReadiness:'UNKNOWN',checkoutResume:null});
});
it.each([null,{}, {...lifecycle,checkoutAvailable:'true'},{...lifecycle,company:{...lifecycle.company,id:99}}])('rejects malformed or foreign lifecycle: %#',async(data)=>{
 m.get.mockResolvedValue({data:{data}});
 await expect(getBillingLifecycle(undefined,42)).rejects.toThrow('Billing response is unavailable');
});
it('validates actual catalog facts and exact checkout response',async()=>{
 m.get.mockResolvedValue({data:{data:[{plan:'PRO',interval:'year',priceId:'pri_'+'a'.repeat(26),productId:'pro_'+'b'.repeat(26),amount:'9999999999999999999',currencyCode:'USD',trialPeriod:null}]}});
 expect((await getBillingCatalog())[0].amount).toBe('9999999999999999999');
 m.post.mockResolvedValue({data:{data:{transactionId,reused:false}}});
 expect(await prepareBillingCheckout('PRO','year')).toEqual({transactionId,reused:false,replaced:false});
 expect(m.post).toHaveBeenCalledWith('/subscription/manage/checkout',{plan:'PRO',interval:'year'},{signal:expect.any(AbortSignal),_retry:true});
});
it('rejects unsafe catalog and checkout without any automatic repeat',async()=>{
 m.get.mockResolvedValue({data:{data:[{amount:123}]}});await expect(getBillingCatalog()).rejects.toThrow();
 m.post.mockResolvedValue({data:{data:{transactionId:'invalid',reused:'true'}}});
 await expect(prepareBillingCheckout('PRO','month')).rejects.toThrow();expect(m.post).toHaveBeenCalledOnce();
});
it('does not retry a lost checkout response',async()=>{
 m.post.mockRejectedValue(new Error('response lost'));
 await expect(prepareBillingCheckout('PRO','month')).rejects.toMatchObject({kind:'offline',sent:true});expect(m.post).toHaveBeenCalledOnce();
});
it.each(['https://customer-portal.paddle.com/fixture?token=synthetic','https://sandbox-customer-portal.paddle.com/fixture'])('permits approved transient portal URL %#',async(url)=>{
 m.post.mockResolvedValue({data:{data:{url}}});expect(await prepareBillingPortal()).toEqual({url});
});
it.each(['http://customer-portal.paddle.com/','https://evil.invalid/','https://customer-portal.paddle.com.evil.invalid/','https://user:pass@customer-portal.paddle.com/','https://customer-portal.paddle.com:443/','https://customer-portal.paddle.com:444/','javascript:alert(1)',' https://customer-portal.paddle.com/',null])('rejects untrusted/userinfo/port portal case %#',async(url)=>{
 m.post.mockResolvedValue({data:{data:{url}}});await expect(prepareBillingPortal()).rejects.toThrow('Billing portal unavailable');expect(m.post).toHaveBeenCalledOnce();
});
it('consumes cancellation and discards a late successful read',async()=>{
 const controller=new AbortController();m.get.mockImplementation(async()=>{controller.abort();return {data:{data:lifecycle}};});
 await expect(getBillingLifecycle(controller.signal,42)).rejects.toThrow();
 expect(m.get).toHaveBeenCalledWith('/subscription/manage/lifecycle',{signal:expect.any(AbortSignal)});
});
it('rejects a foreign legacy subscription summary',async()=>{
 m.get.mockResolvedValue({data:{data:{company:{id:99}}}});await expect(getSubscription(undefined,42)).rejects.toThrow('Billing response is unavailable');
});

const requests = [
 {name:'pricing',run:()=>getPricingContext(),limit:15000,method:'get'},
 {name:'subscription',run:()=>getSubscription(),limit:15000,method:'get'},
 {name:'lifecycle',run:()=>getBillingLifecycle(),limit:15000,method:'get'},
 {name:'catalog',run:()=>getBillingCatalog(),limit:15000,method:'get'},
 {name:'checkout',run:()=>prepareBillingCheckout('PRO','month'),limit:45000,method:'post'},
 {name:'legacy portal',run:()=>createCustomerPortalSession(),limit:45000,method:'post'},
 {name:'managed portal',run:()=>prepareBillingPortal(),limit:45000,method:'post'},
 {name:'confirm',run:()=>confirmBillingCheckout(),limit:20000,method:'post'},
 {name:'reconcile',run:()=>reconcileBillingCheckout(),limit:30000,method:'post'},
] as const;
it.each(requests)('bounds a never-settling $name at $limit ms without retry',async({run,limit,method})=>{
 vi.useFakeTimers();m[method].mockImplementation(()=>new Promise(()=>{}));
 const promise=run();
 const assertion=expect(promise).rejects.toMatchObject({kind:'timed_out_after_send',sent:true});
 const signal=m[method].mock.calls[0][method==='post'?2:1].signal as AbortSignal;
 await vi.advanceTimersByTimeAsync(limit-1);expect(signal.aborted).toBe(false);
 await vi.advanceTimersByTimeAsync(1);await assertion;
 expect(signal.aborted).toBe(true);expect(m[method]).toHaveBeenCalledOnce();
 if(method==='post')expect(m.post.mock.calls[0][2]._retry).toBe(true);
 expect(vi.getTimerCount()).toBe(0);
});
it('caller cancellation wins before the prepare deadline even if the adapter ignores it',async()=>{
 vi.useFakeTimers();const controller=new AbortController();
 m.post.mockImplementation(()=>new Promise(()=>{}));
 const promise=prepareBillingCheckout('PRO','month',controller.signal);
 const assertion=expect(promise).rejects.toMatchObject({kind:'timed_out_after_send',sent:true});
 controller.abort();await assertion;expect(vi.getTimerCount()).toBe(0);
 expect(m.post).toHaveBeenCalledOnce();
});
it('does not dispatch a pre-aborted POST',async()=>{
 const controller=new AbortController();controller.abort();
 await expect(confirmBillingCheckout(controller.signal)).rejects.toMatchObject({kind:'not_sent',sent:false});
 expect(m.post).not.toHaveBeenCalled();
});
const outcomes = [
 {run:confirmBillingCheckout,path:'confirm',valid:'PROCESSING',invalid:'RESUMABLE'},
 {run:reconcileBillingCheckout,path:'reconcile',valid:'RESUMABLE',invalid:'ACTIVE'},
];
it.each(outcomes)('posts an empty body to $path and parses scoped lifecycle',async({run,path,valid})=>{
 m.post.mockResolvedValue({data:{data:{outcome:valid,lifecycle,extra:'discard'}}});
 expect(await run(undefined,42)).toMatchObject({outcome:valid,lifecycle:{company:{id:42},workspaceAccessAllowed:false}});
 expect(m.post).toHaveBeenCalledExactlyOnceWith('/subscription/manage/checkout/'+path,{}, {signal:expect.any(AbortSignal),_retry:true});
});
it.each(outcomes)('strictly rejects malformed or foreign $path results',async({run,valid,invalid})=>{
 for(const data of [null,{}, {outcome:invalid,lifecycle}, {outcome:valid,lifecycle:{...lifecycle,workspaceAccessAllowed:'true'}}, {outcome:valid,lifecycle:{...lifecycle,company:{...lifecycle.company,id:99}}}]){
  m.post.mockResolvedValue({data:{data}});
  await expect(run(undefined,42)).rejects.toThrow('Billing response is unavailable');
 }
 expect(m.post).toHaveBeenCalledTimes(5);
});
it.each([401,403,409,429,503])('preserves HTTP %s and code without retrying a POST',async(status)=>{
 m.post.mockRejectedValue({response:{status,data:{code:'BILLING_UNAVAILABLE',message:'private detail'}}});
 await expect(confirmBillingCheckout()).rejects.toMatchObject({kind:'server',sent:true,status,code:'BILLING_UNAVAILABLE',response:{status}});
 expect(m.post).toHaveBeenCalledOnce();
});
it('the shared refresh interceptor cannot replay a billing POST on expired-token 401',async()=>{
 m.post.mockResolvedValue({data:{data:{transactionId,reused:false}}});
 await prepareBillingCheckout('PRO','month');
 const config=m.post.mock.calls[0][2];
 const {client:actualClient}=await vi.importActual<typeof import('@/api/client')>('@/api/client');
 const previous=actualClient.defaults.adapter;
 const adapter=vi.fn(async(request:InternalAxiosRequestConfig)=>{
  throw {config:request,response:{status:401,data:{message:'Access Token Expired'}}};
 });
 actualClient.defaults.adapter=adapter;
 try {
  await expect(actualClient.post('/subscription/manage/checkout',{plan:'PRO',interval:'month'},config)).rejects.toMatchObject({response:{status:401}});
  expect(adapter).toHaveBeenCalledOnce();
 } finally {actualClient.defaults.adapter=previous;}
});
