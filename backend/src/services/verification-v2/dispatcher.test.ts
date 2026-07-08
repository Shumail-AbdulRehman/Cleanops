import {it, expect, vi} from 'vitest';
import {dispatchVerificationJobs} from './dispatcher.js';

it('refills a completed slot while another job is still blocked, with bounded concurrency', async () => {
 let releaseSlow!:()=>void; const slow = new Promise<void>(r=>{releaseSlow=r;});
 let started=0,active=0,peak=0,stop=false;
 const events:number[]=[];
 const claim=vi.fn(async()=>started<3?++started:null);
 const run=dispatchVerificationJobs({claim,concurrency:2,idleMs:2,stopping:()=>stop,onError:e=>{throw e;},process:async job=>{
  active++;peak=Math.max(peak,active);events.push(job);
  if(job===1)await slow;
  if(job===3){stop=true;releaseSlow();}
  active--;
 }});
 await run;
 expect(events).toEqual([1,2,3]);expect(peak).toBe(2);
});
it('drains active work on stop and recovers from processing failure',async()=>{
 let stop=false;const error=new Error('transient');const onError=vi.fn();let next=0;
 await dispatchVerificationJobs({claim:async()=>++next,process:async()=>{stop=true;throw error;},stopping:()=>stop,onError,concurrency:1,idleMs:1});
 expect(onError).toHaveBeenCalledWith(error);
});
it('rejects concurrency outside the durable global cap',async()=>{
 await expect(dispatchVerificationJobs({claim:async()=>null,process:async()=>{},stopping:()=>true,onError:()=>{},concurrency:5})).rejects.toThrow('1–4');
});
