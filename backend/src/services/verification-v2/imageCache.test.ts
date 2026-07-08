import {it,expect,vi} from 'vitest';
import {createEvidenceImageCache} from './imageCache.js';
it('deduplicates simultaneous downloads and keeps protected tenant paths separate',async()=>{
 const read=vi.fn(async(path:string)=>Buffer.from(path));const cache=createEvidenceImageCache(read,1024,1000);
 const [a,b]=await Promise.all([cache('company/1/photo','jpg'),cache('company/1/photo','jpg')]);
 expect(a).toBe(b);expect(read).toHaveBeenCalledTimes(1);
 await cache('company/2/photo','jpg');await cache('company/1/photo','jpg');expect(read).toHaveBeenCalledTimes(2);
});
it('evicts bounded assets and retries failed downloads',async()=>{
 const read=vi.fn(async()=>Buffer.alloc(4));const cache=createEvidenceImageCache(read,5,1000);
 await cache('a','jpg');await cache('b','jpg');await cache('a','jpg');expect(read).toHaveBeenCalledTimes(3);
 read.mockRejectedValueOnce(new Error('network'));await expect(cache('c','jpg')).rejects.toThrow('network');await cache('c','jpg');expect(read).toHaveBeenCalledTimes(5);
});
it('expires private image bytes without disk persistence',async()=>{
 vi.useFakeTimers();try{const read=vi.fn(async()=>Buffer.from('a')),cache=createEvidenceImageCache(read,10,5);
 await cache('a','jpg');vi.advanceTimersByTime(6);await cache('a','jpg');expect(read).toHaveBeenCalledTimes(2);
 }finally{vi.useRealTimers();}
});
