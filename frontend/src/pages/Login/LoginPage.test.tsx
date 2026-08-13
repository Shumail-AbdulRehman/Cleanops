import type {ReactNode} from 'react';
import {configureStore} from '@reduxjs/toolkit';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {Provider} from 'react-redux';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import {beforeEach,it,expect,vi} from 'vitest';
import authReducer,{setUser,type AuthUser} from '@/store/slices/authSlice';
import {LanguageProvider} from '@/i18n/LanguageProvider';
import {GuestRoute} from '@/App';
import Login from './LoginPage';
import SignUp from '../Signup/SignUpPage';
const api=vi.hoisted(()=>({get:vi.fn(),post:vi.fn()}));
vi.mock('@/api/client',()=>({client:api}));
const owner:AuthUser={id:4,role:'ADMIN',companyId:20,name:'Synthetic owner',email:'synthetic@example.invalid'};
function mount(content:ReactNode,{language='en',path='/login',user}:{language?:string;path?:string;user?:AuthUser}={}){
 localStorage.setItem('hygene-ops.language',language);
 const store=configureStore({reducer:{auth:authReducer}});if(user)store.dispatch(setUser(user));
 const query=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});query.setQueryData(['previous-tenant'],{private:true});
 const view=render(<Provider store={store}><QueryClientProvider client={query}><LanguageProvider><MemoryRouter initialEntries={[path]}><Routes><Route path={path} element={content}/><Route path="/choose-plan" element={<h1>Billing destination</h1>}/><Route path="/continue" element={<h1>Continuation destination</h1>}/><Route path="/dashboard" element={<h1>Workspace destination</h1>}/></Routes></MemoryRouter></LanguageProvider></QueryClientProvider></Provider>);
 return {...view,store,query};
}
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();api.post.mockResolvedValue({data:{data:owner}});});
it.each(['Manager','Staff'] as const)('keeps real %s sign-in payload, cache clearing and authenticated identity',async role=>{
 const user={...owner,role:role==='Staff'?'STAFF':'ADMIN'};api.post.mockResolvedValue({data:{data:user}});const {store,query}=mount(<Login/>);
 expect(screen.queryByRole('combobox')).not.toBeInTheDocument();fireEvent.change(screen.getByLabelText('Email'),{target:{value:owner.email}});fireEvent.change(screen.getByLabelText('Password'),{target:{value:'Synthetic test password'}});fireEvent.click(screen.getByRole('button',{name:'Sign in'}));
 await waitFor(()=>expect(store.getState().auth.user?.role).toBe(user.role));
 expect(api.post).toHaveBeenCalledWith('/common/login',{email:owner.email,password:'Synthetic test password'},{withCredentials:true});
 expect(query.getQueryData(['previous-tenant'])).toBeUndefined();expect(query.getQueryData(['currentUser'])).toEqual(user);
});
it('rejects empty fields before contacting authentication and exposes linked errors',async()=>{
 mount(<Login/>);fireEvent.click(screen.getByRole('button',{name:'Sign in'}));await screen.findByText('Email is required');expect(api.post).not.toHaveBeenCalled();expect(screen.getByLabelText('Email')).toHaveAttribute('aria-describedby','email-error');expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid','true');
});
it('keeps credentials available for correction and renders a translated denial without raw server details',async()=>{
 api.post.mockRejectedValue({response:{status:401,data:{message:'Private authentication diagnostic'}}});const {store}=mount(<Login/>,{language:'ur'});
 fireEvent.change(screen.getByLabelText('ای میل'),{target:{value:owner.email}});fireEvent.change(screen.getByLabelText('پاس ورڈ'),{target:{value:'Synthetic wrong password'}});fireEvent.click(screen.getByRole('button',{name:'سائن ان'}));
 await screen.findByText('ای میل یا پاس ورڈ درست نہیں۔');expect(screen.getByLabelText('پاس ورڈ')).toHaveValue('');expect(screen.getByLabelText('ای میل')).toHaveValue(owner.email);expect(screen.getByLabelText('ای میل')).toHaveAttribute('dir','ltr');expect(document.documentElement.dir).toBe('rtl');expect(screen.queryByText('Private authentication diagnostic')).not.toBeInTheDocument();expect(store.getState().auth.user).toBeNull();
});
it.each([['/signup','ADMIN','Continuation destination'],['/signup','MANAGER','Workspace destination'],['/login','ADMIN','Continuation destination']] as const)('routes authenticated %s/%s consistently',async(path,role,destination)=>{
 mount(<GuestRoute><Login/></GuestRoute>,{path,user:{...owner,role}});expect(await screen.findByRole('heading',{name:destination})).toBeInTheDocument();
});
it('keeps registration session-delivery failure unauthenticated with an accurate receipt',async()=>{
 api.post.mockResolvedValue({data:{data:{...owner,sessionEstablished:false}}});const {store}=mount(<SignUp/>,{path:'/signup'});
 for(const [label,value]of [['Your name','Synthetic owner'],['Company name','Synthetic company'],['Work email',owner.email],['Password','Synthetic password']])fireEvent.change(screen.getByLabelText(label),{target:{value}});
 fireEvent.click(screen.getByRole('button',{name:'Continue to plans'}));await screen.findByText('Your account is ready. Sign in to continue.');expect(store.getState().auth.user).toBeNull();expect(screen.queryByRole('heading',{name:'Billing destination'})).not.toBeInTheDocument();expect(screen.getByRole('link',{name:'Sign in'})).toHaveAttribute('href','/login');
});
it('translates registration fields and validation using FlowShell',async()=>{
 mount(<SignUp/>,{language:'ur',path:'/signup'});expect(screen.getByRole('heading',{name:'اپنا اکاؤنٹ بنائیں'})).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'پلانز کی طرف جائیں'}));expect(await screen.findAllByText('یہ خانہ ضروری ہے۔')).toHaveLength(4);expect(screen.getByLabelText('آپ کا نام')).toHaveAttribute('aria-invalid','true');expect(screen.getByRole('link',{name:'سائن ان'})).toHaveAttribute('href','/login');expect(screen.getAllByRole('group',{name:'زبان'})).toHaveLength(1);
});

it('reveals and hides the existing password without submitting or changing credentials',()=>{
 mount(<Login/>);const password=screen.getByLabelText('Password');
 fireEvent.change(password,{target:{value:'Synthetic test password'}});
 expect(password).toHaveAttribute('type','password');
 fireEvent.click(screen.getByRole('button',{name:'Show password'}));
 expect(password).toHaveAttribute('type','text');expect(password).toHaveValue('Synthetic test password');
 expect(screen.getByRole('button',{name:'Hide password'})).toHaveAttribute('aria-pressed','true');
 fireEvent.click(screen.getByRole('button',{name:'Hide password'}));
 expect(password).toHaveAttribute('type','password');expect(api.post).not.toHaveBeenCalled();
 expect(screen.getByRole('link',{name:'Platform owner sign-in'})).toHaveAttribute('href','/platform/login');
 expect(screen.getByRole('link',{name:'Forgot password?'})).toHaveAttribute('href','/recover-owner-account');
 expect(screen.getAllByRole('group',{name:'Language'})).toHaveLength(1);
});

it('translates the split login, platform link and password visibility for Urdu',()=>{
 mount(<Login/>,{language:'ur'});
 expect(screen.getByRole('heading',{name:'خوش آمدید'})).toBeInTheDocument();
 expect(screen.getByRole('link',{name:'پلیٹ فارم مالک سائن ان'})).toHaveAttribute('href','/platform/login');
 fireEvent.click(screen.getByRole('button',{name:'پاس ورڈ دکھائیں'}));
 expect(screen.getByLabelText('پاس ورڈ')).toHaveAttribute('type','text');
 expect(screen.getByRole('button',{name:'پاس ورڈ چھپائیں'})).toBeInTheDocument();
 expect(document.documentElement.dir).toBe('rtl');
});

function enterCredentials() {
 fireEvent.change(screen.getByLabelText('Email'),{target:{value:owner.email}});
 fireEvent.change(screen.getByLabelText('Password'),{target:{value:'Synthetic test password'}});
}
it.each([
 [400,{}, {},'Email or password is incorrect.'],
 [401,{}, {},'Email or password is incorrect.'],
 [403,{code:'ACCOUNT_DEACTIVATED'}, {},'This account is deactivated. Contact your company owner.'],
 [403,{errors:[{code:'ACCOUNT_DEACTIVATED'}]}, {},'This account is deactivated. Contact your company owner.'],
 [403,{code:'OTHER',message:'Account is deactivated'}, {},'Sign-in is unavailable for this account. Contact your company owner.'],
 [429,{}, {'retry-after':'61'},'Too many attempts. Try again in 61 seconds.'],
 [429,{}, {'retry-after':'invalid'},'Too many attempts. Try again in a few minutes.'],
 [429,{}, {},'Too many attempts. Try again in a few minutes.'],
 [500,{}, {},'We could not reach Hygene Ops. Check your connection and try again.'],
 [503,{}, {},'We could not reach Hygene Ops. Check your connection and try again.'],
] as const)('handles HTTP %s safely (%j, %j)',async(status,data,headers,message)=>{
 api.post.mockRejectedValue({response:{status,data,headers}});mount(<Login/>);enterCredentials();
 fireEvent.click(screen.getByRole('button',{name:'Sign in'}));
 expect(await screen.findByRole('alert')).toHaveTextContent(message);
 expect(screen.getByLabelText('Email')).toHaveValue(owner.email);
 expect(screen.getByLabelText('Password')).toHaveValue(status===401?'':'Synthetic test password');
});
it('keeps both inputs after a network failure',async()=>{
 api.post.mockRejectedValue(new Error('Private network diagnostic'));mount(<Login/>);enterCredentials();
 fireEvent.click(screen.getByRole('button',{name:'Sign in'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('We could not reach Hygene Ops. Check your connection and try again.');
 expect(screen.getByLabelText('Password')).toHaveValue('Synthetic test password');
 expect(screen.getByLabelText('Email')).toHaveValue(owner.email);
});
it('sends one request for same-tick submissions, stays busy, and allows retry after failure',async()=>{
 let rejectRequest!:(value:unknown)=>void;
 api.post.mockReturnValueOnce(new Promise((_resolve,reject)=>{rejectRequest=reject;}));
 mount(<Login/>);enterCredentials();const form=screen.getByLabelText('Email').closest('form')!;
 fireEvent.submit(form);fireEvent.submit(form);
 const busy=await screen.findByRole('button',{name:'Signing in…'});
 expect(busy).toBeDisabled();expect(busy).toHaveAttribute('aria-busy','true');expect(api.post).toHaveBeenCalledTimes(1);
 rejectRequest({response:{status:500}});await screen.findByRole('alert');
 fireEvent.click(screen.getByRole('button',{name:'Sign in'}));await waitFor(()=>expect(api.post).toHaveBeenCalledTimes(2));
});
it('exposes keyboard controls in reading order with no positive tabindex',()=>{
 const {container}=mount(<Login/>);
 const controls=Array.from(container.querySelector('main')!.querySelectorAll('input,button,a')).map(element=>element.getAttribute('id')||element.textContent);
 expect(controls).toEqual(['email','Forgot password?','password','Show','Sign in','Create an account','Platform owner sign-in']);
 expect(container.querySelector('[tabindex="1"]')).toBeNull();
 expect(screen.getByRole('heading',{name:'Welcome back'})).toHaveFocus();
 // Walk the form's native focus targets in document order; no custom key handler interferes.
 for(const element of container.querySelector('main')!.querySelectorAll<HTMLElement>('input,button,a')) {
  element.focus();expect(element).toHaveFocus();
 }
});
it('shows the security completion notice and keeps worksheet examples out of the accessibility tree',()=>{
 // The route state comes from the existing account security flow.
 const query=new QueryClient();
 const store=configureStore({reducer:{auth:authReducer}});
 const {container}=render(<Provider store={store}><QueryClientProvider client={query}><LanguageProvider><MemoryRouter initialEntries={[{pathname:'/login',state:{securityCompleted:true}}]}><Login/></MemoryRouter></LanguageProvider></QueryClientProvider></Provider>);
 expect(screen.getByRole('status')).toHaveTextContent('Security details updated. Sign in again to continue.');
 expect(screen.getByText('Example day').closest('[aria-hidden="true"]')).not.toBeNull();
 expect(screen.queryByRole('list')).not.toBeInTheDocument();
 expect(container.querySelectorAll('.login-worksheet [data-complete="true"]')).toHaveLength(3);
});
it('rejects invalid email without a request',async()=>{
 mount(<Login/>);enterCredentials();fireEvent.change(screen.getByLabelText('Email'),{target:{value:'invalid'}});
 fireEvent.click(screen.getByRole('button',{name:'Sign in'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid email address.');expect(api.post).not.toHaveBeenCalled();
});
it('updates error copy and direction when language changes without losing the draft or replaying rows',async()=>{
 api.post.mockRejectedValue({response:{status:429,headers:{'retry-after':'9'}}});
 const {container}=mount(<Login/>);enterCredentials();
 const worksheet=container.querySelector('.login-worksheet');
 fireEvent.click(screen.getByRole('button',{name:'Sign in'}));await screen.findByRole('alert');
 fireEvent.click(screen.getByRole('button',{name:'اردو'}));
 expect(screen.getByRole('alert')).toHaveTextContent('بہت زیادہ کوششیں ہو گئیں۔ 9 سیکنڈ بعد دوبارہ کوشش کریں۔');
 expect(screen.getByLabelText('ای میل')).toHaveValue(owner.email);
 expect(screen.getByLabelText('پاس ورڈ')).toHaveValue('Synthetic test password');
 expect(container.querySelector('.flow-shell')).toHaveAttribute('dir','rtl');
 expect(container.querySelector('.login-worksheet')).toBe(worksheet);
});
