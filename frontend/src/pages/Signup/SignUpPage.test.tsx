import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import authReducer from '@/store/slices/authSlice';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { LanguageContext } from '@/i18n/context';
import { translate } from '@/i18n/translations';
import SignUp from './SignUpPage';
const m=vi.hoisted(()=>({post:vi.fn()}));
vi.mock('@/api/client',()=>({client:{post:m.post}}));
const account={id:7,companyId:42,role:'ADMIN',name:'Fixture owner',email:'owner@example.invalid'};
const form={name:'Fixture owner',companyName:'Fixture company',email:'owner@example.invalid',password:'abcdefgh'};
function mount(entry='/signup'){
 const store=configureStore({reducer:{auth:authReducer}});
 const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 client.setQueryData(['old-owner'],{private:'old'});
 const view=render(<Provider store={store}><QueryClientProvider client={client}><LanguageProvider><MemoryRouter initialEntries={[entry]}><Routes><Route path="/signup" element={<SignUp/>}/><Route path="/choose-plan" element={<h1>Choose plan destination</h1>}/><Route path="/login" element={<h1>Sign in destination</h1>}/></Routes></MemoryRouter></LanguageProvider></QueryClientProvider></Provider>);
 return {...view,store,client};
}
function fill(patch:Partial<typeof form>={}){
 const data={...form,...patch};
 for(const [label,key] of [['Your name','name'],['Company name','companyName'],['Work email','email'],['Password','password']] as const)fireEvent.change(screen.getByLabelText(label),{target:{value:data[key]}});
}
function submit(){fireEvent.click(screen.getByRole('button',{name:'Continue to plans'}));}
beforeEach(()=>{vi.resetAllMocks();localStorage.clear();vi.stubEnv('VITE_SERVICE_POLICIES_APPROVED','false');m.post.mockResolvedValue({data:{data:{...account,sessionEstablished:true}}});});
afterEach(()=>{vi.unstubAllEnvs();localStorage.clear();document.documentElement.dir='ltr';});
it('renders account step and labeled/autocomplete fields with no unsupported help or payment controls',()=>{
 const {container}=mount();expect(screen.getByRole('heading',{name:'Create your account'})).toBeVisible();
 expect(screen.getByText('Account').closest('li')).toHaveAttribute('aria-current','step');
 expect(screen.getByLabelText('Your name')).toHaveAttribute('autocomplete','name');expect(screen.getByLabelText('Company name')).toHaveAttribute('autocomplete','organization');
 expect(screen.getByLabelText('Work email')).toHaveAttribute('dir','ltr');expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete','new-password');
 expect(screen.queryByText(/help|contact|support|faq/i)).not.toBeInTheDocument();expect(container.querySelector('a[href="#"],a[href^="mailto:"]')).toBeNull();
 expect(screen.queryByLabelText(/card number/i)).not.toBeInTheDocument();expect(screen.getByRole('link',{name:'Sign in'})).toHaveAttribute('href','/login');
});
it('requires all four fields and connects inline errors to inputs',async()=>{
 mount();submit();await waitFor(()=>expect(screen.getAllByRole('alert')).toHaveLength(4));
 expect(m.post).not.toHaveBeenCalled();for(const label of ['Your name','Company name','Work email','Password']){const input=screen.getByLabelText(label);expect(input).toHaveAttribute('aria-invalid','true');expect(document.getElementById(input.getAttribute('aria-describedby')!.split(' ').at(-1)!)).toBeVisible();}
});
it.each([{email:'not-an-email'},{password:'12345'},{name:'   '},{companyName:'   '}])('rejects invalid form case %# before signup',async(patch)=>{
 mount();fill(patch);submit();await screen.findByRole('alert');expect(m.post).not.toHaveBeenCalled();
});
it('preserves eight-character minimum and real successful hook/session navigation',async()=>{
 const {store,client}=mount();fill();submit();await screen.findByRole('heading',{name:'Choose plan destination'});
 expect(m.post).toHaveBeenCalledWith('/manager/manager-signup',form,{withCredentials:true});expect(store.getState().auth.user?.id).toBe(7);expect(client.getQueryData(['old-owner'])).toBeUndefined();
});
it('blocks duplicate slow submissions without clearing the typed draft',async()=>{
 let resolve!:(value:unknown)=>void;m.post.mockReturnValue(new Promise(r=>{resolve=r;}));mount();fill();const button=screen.getByRole('button',{name:'Continue to plans'});fireEvent.click(button);fireEvent.click(button);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Creating your account…'})).toBeDisabled());expect(m.post).toHaveBeenCalledOnce();expect(screen.getByLabelText('Work email')).toHaveValue(form.email);
 await act(async()=>resolve({data:{data:{...account,sessionEstablished:true}}}));await screen.findByRole('heading',{name:'Choose plan destination'});expect(m.post).toHaveBeenCalledOnce();
});
it('server failure preserves draft and shows a safe retry without private errors',async()=>{
 m.post.mockRejectedValue({response:{status:500,data:{message:'private SQL credentials'}}});mount();fill();submit();
 expect(await screen.findByRole('alert')).toHaveTextContent('Your account could not be created');expect(screen.queryByText('private SQL credentials')).not.toBeInTheDocument();
 for(const [label,value] of [['Your name',form.name],['Company name',form.companyName],['Work email',form.email],['Password',form.password]])expect(screen.getByLabelText(label)).toHaveValue(value);
 expect(screen.getByRole('button',{name:'Continue to plans'})).toBeEnabled();
});
it('duplicate account shows its actionable server validation without a new identity',async()=>{
 m.post.mockRejectedValue({response:{status:409,data:{message:'unrelated text',errors:[{code:'EMAIL_EXISTS',field:'email'}]}}});const {store}=mount();fill();submit();
 expect(await screen.findByRole('alert')).toHaveTextContent('This email already has an account.');expect(store.getState().auth.user).toBeNull();expect(screen.getByRole('link',{name:'Sign in'})).toHaveAttribute('href','/login');
});
it('durable account with failed session offers sign-in instead of a second signup',async()=>{
 m.post.mockResolvedValue({data:{data:{...account,sessionEstablished:false}}});const {store,client}=mount();fill();submit();
 expect(await screen.findByRole('status')).toHaveTextContent('Your account is ready. Sign in to continue.');expect(store.getState().auth.user).toBeNull();expect(client.getQueryData(['currentUser'])).toBeUndefined();
 expect(screen.queryByRole('button',{name:'Continue to plans'})).not.toBeInTheDocument();fireEvent.click(screen.getByRole('link',{name:'Sign in'}));await screen.findByRole('heading',{name:'Sign in destination'});expect(m.post).toHaveBeenCalledOnce();
});
it('EN/UR changes keep form node and typed values and translate validation',async()=>{
 mount();fill({password:'12345'});const name=screen.getByLabelText('Your name');fireEvent.click(screen.getByRole('button',{name:'اردو'}));
 expect(screen.getByLabelText('آپ کا نام')).toBe(name);expect(screen.getByLabelText('کام کی ای میل')).toHaveValue(form.email);expect(screen.getByLabelText('پاس ورڈ')).toHaveValue('12345');
 fireEvent.click(screen.getByRole('button',{name:'پلانز کی طرف جائیں'}));expect(await screen.findByRole('alert')).toHaveTextContent('کم از کم 8 حروف استعمال کریں');expect(m.post).not.toHaveBeenCalled();
});
it('a context language update preserves focused input without remounting',()=>{
 const store=configureStore({reducer:{auth:authReducer}});const client=new QueryClient();
 function Wrapper({language,children}:{language:'en'|'ur';children:ReactNode}){return <Provider store={store}><QueryClientProvider client={client}><MemoryRouter><LanguageContext.Provider value={{language,setLanguage:()=>{},t:(text,values)=>translate(text,language,values)}}>{children}</LanguageContext.Provider></MemoryRouter></QueryClientProvider></Provider>;}
 const child=<SignUp/>;const view=render(<Wrapper language="en">{child}</Wrapper>);const input=screen.getByLabelText('Your name');act(()=>input.focus());
 view.rerender(<Wrapper language="ur">{child}</Wrapper>);expect(screen.getByLabelText('آپ کا نام')).toBe(input);expect(input).toHaveFocus();
});

it('uses the code to offer sign-in and preserves the allowlisted query on that link', async () => {
 m.post.mockRejectedValue({response:{status:409,data:{errors:[{code:'EMAIL_EXISTS'}]}}});
 mount('/signup?plan=ADVANCED&interval=year&token=discard'); fill(); submit();
 await screen.findByRole('alert');
 expect(screen.getByRole('link',{name:'Sign in instead'})).toHaveAttribute('href','/login?plan=ADVANCED&interval=year');
 for(const [label,key] of [['Your name','name'],['Company name','companyName'],['Work email','email'],['Password','password']] as const)expect(screen.getByLabelText(label)).toHaveValue(form[key]);
});
it('does not interpret duplicate-looking message text as EMAIL_EXISTS', async () => {
 m.post.mockRejectedValue({response:{status:409,data:{message:'Manager with this email already exists'}}});
 mount(); fill(); submit();
 expect(await screen.findByRole('alert')).toHaveTextContent('Your account could not be created');
 expect(screen.queryByRole('link',{name:'Sign in instead'})).not.toBeInTheDocument();
});
it('associates server validation errors with their fields and preserves the draft', async () => {
 m.post.mockRejectedValue({response:{status:400,data:{errors:[{field:'companyName',message:'Use a longer company name.'},{field:'email',message:'Use a work email.'}]}}});
 mount();fill();submit();
 await waitFor(()=>expect(screen.getAllByRole('alert')).toHaveLength(2));
 expect(screen.getByLabelText('Company name')).toHaveAttribute('aria-describedby','companyName-error');
 expect(screen.getByLabelText('Work email')).toHaveAttribute('aria-invalid','true');
 expect(screen.getByText('Use a longer company name.')).toBeVisible();
 expect(screen.getByLabelText('Password')).toHaveValue(form.password);
});
it('reveals and hides the password without changing its value', () => {
 mount();fill(); const input=screen.getByLabelText('Password');
 fireEvent.click(screen.getByRole('button',{name:'Show'}));
 expect(input).toHaveAttribute('type','text');expect(input).toHaveValue(form.password);
 expect(screen.getByRole('button',{name:'Hide'})).toHaveAttribute('aria-pressed','true');
 fireEvent.click(screen.getByRole('button',{name:'Hide'}));expect(input).toHaveAttribute('type','password');
});
it('rejects seven characters before signup', async () => {
 mount();fill({password:'1234567'});submit();
 expect(await screen.findByRole('alert')).toHaveTextContent('Use at least 8 characters.');expect(m.post).not.toHaveBeenCalled();
});
it('shows the rate-limit wait, preserves values and blocks resubmit until it ends', async () => {
 m.post.mockRejectedValueOnce({response:{status:429,headers:{'retry-after':'2'},data:{message:'private'}}});
 mount();fill();submit();await screen.findByRole('status');

 expect(screen.getByRole('status')).toHaveTextContent('Try again in 2 seconds.');
 expect(screen.getByRole('button',{name:'Continue to plans'})).toBeDisabled();
 fireEvent.submit(screen.getByRole('button',{name:'Continue to plans'}).closest('form')!);
 await act(async()=>{});expect(m.post).toHaveBeenCalledOnce();
 expect(screen.getByLabelText('Password')).toHaveValue(form.password);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Continue to plans'})).toBeEnabled(), {timeout:3500});
});
it('gives a safe wait explanation when Retry-After is absent', async () => {
 m.post.mockRejectedValue({response:{status:429,data:{}}});mount();fill();submit();
 expect(await screen.findByRole('status')).toHaveTextContent('Too many attempts. Try again in a few minutes.');
 expect(screen.getByLabelText('Password')).toHaveValue(form.password);
});
