import {beforeEach,expect,it,vi} from 'vitest';
beforeEach(()=>{vi.resetModules();localStorage.clear();window.history.replaceState(null,'','/');});
it('scrubs all fragments and query strings immediately, captures only exact owner link tokens in volatile memory',async()=>{
 const token='a'.repeat(43);window.history.replaceState(null,'',`/reset-owner-password?tracking=no#token=${token}`);
 const module=await import('./linkToken');expect(window.location.hash).toBe('');expect(window.location.search).toBe('');expect(module.ownerLinkToken('/reset-owner-password')).toBe(token);expect(module.ownerLinkToken('/verify-owner-email')).toBeUndefined();expect(localStorage.length).toBe(0);module.forgetOwnerLinkToken();expect(module.ownerLinkToken('/reset-owner-password')).toBeUndefined();
});
it('malformed owner fragments are scrubbed and cannot become credentials',async()=>{
 window.history.replaceState(null,'','/verify-owner-email#token=invalid');const module=await import('./linkToken');expect(window.location.hash).toBe('');expect(module.ownerLinkToken('/verify-owner-email')).toBeUndefined();
});
it('unrelated routes do not interpret fragments as owner credentials',async()=>{
 window.history.replaceState(null,'','/dashboard#token=not-an-owner-link');const module=await import('./linkToken');expect(window.location.hash).toBe('#token=not-an-owner-link');expect(module.ownerLinkToken('/dashboard')).toBeUndefined();
});
