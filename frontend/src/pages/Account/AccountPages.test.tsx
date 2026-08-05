import {configureStore} from '@reduxjs/toolkit';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {Provider} from 'react-redux';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import {beforeEach,expect,it,vi} from 'vitest';
import authReducer,{setUser,type AuthUser} from '@/store/slices/authSlice';
import {LanguageProvider} from '@/i18n/LanguageProvider';
import {CompanySettingsPage,OwnerRecoveryPage,OwnerLinkPage,OwnSecurityPage} from './AccountPages';
import {requiresPasswordChange} from './api';
const m=vi.hoisted(()=>({get:vi.fn(),post:vi.fn(),patch:vi.fn(),token:vi.fn(),forget:vi.fn()}));
vi.mock('@/api/client',()=>({client:{get:m.get,post:m.post,patch:m.patch}}));
vi.mock('./linkToken',()=>({ownerLinkToken:m.token,forgetOwnerLinkToken:m.forget}));
const fixture={id:42,name:'Synthetic company',accountVersion:3,updatedAt:'2026-10-21T00:00:00Z'};
let identity={emailVerified:false,deliveryConfigured:true,bootstrapRequired:false};
function mount(page:React.ReactNode,role:AuthUser['role']|null='ADMIN',language='en') {
 localStorage.setItem('hygene-ops.language',language);
 const store=configureStore({reducer:{auth:authReducer}});
 if(role)store.dispatch(setUser({id:7,role,name:'Synthetic account',email:'fixture@example.invalid',companyId:42}));
 const query=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
 query.setQueryData(['private-operational-data'],{private:true});
 const view=render(<Provider store={store}><QueryClientProvider client={query}><LanguageProvider><MemoryRouter initialEntries={['/test']}><Routes><Route path="/test" element={<div className="workspace">{page}</div>}/><Route path="/login" element={<h1>Sign in again</h1>}/></Routes></MemoryRouter></LanguageProvider></QueryClientProvider></Provider>);
 return {...view,store,query};
}
beforeEach(()=>{
 vi.clearAllMocks();localStorage.clear();identity={emailVerified:false,deliveryConfigured:true,bootstrapRequired:false};
 m.get.mockImplementation(async(url:string)=>({data:{data:url==='/company/settings'?fixture:identity}}));
 m.post.mockResolvedValue({data:{data:{completed:true,requestAccepted:true,deliveryConfirmed:false}}});
 m.patch.mockImplementation(async(_url,body)=>({data:{data:{company:{...fixture,name:body.name,accountVersion:4},changed:true}}}));
 m.token.mockReturnValue('a'.repeat(43));
});
it('owner reads persisted settings and saves using the actual version, displaying returned persistence',async()=>{
 mount(<CompanySettingsPage/>);const name=await screen.findByLabelText('Company name');expect(name).toHaveValue(fixture.name);
 fireEvent.change(name,{target:{value:'Updated synthetic company'}});fireEvent.click(screen.getByRole('button',{name:'Save company name'}));
 await screen.findByText('Company settings saved.');expect(m.patch).toHaveBeenCalledWith('/company/settings',{name:'Updated synthetic company',expectedVersion:3});
 expect(screen.getByText('Saved company name: Updated synthetic company')).toBeInTheDocument();
});
it('manager never requests owner settings or owner identity, but has separate own security',()=>{
 mount(<CompanySettingsPage/>,'MANAGER');expect(screen.getByRole('alert')).toHaveTextContent('Only the company owner');expect(m.get).not.toHaveBeenCalled();expect(screen.getByRole('link',{name:'Your account security'})).toHaveAttribute('href','/account/security');
});
it('settings conflict and denial keep the draft and never claim successful persistence',async()=>{
 m.patch.mockRejectedValue({response:{status:409}});mount(<CompanySettingsPage/>);
 fireEvent.change(await screen.findByLabelText('Company name'),{target:{value:'Keep this draft'}});fireEvent.click(screen.getByRole('button',{name:'Save company name'}));
 await screen.findByRole('alert');expect(screen.getByLabelText('Company name')).toHaveValue('Keep this draft');expect(screen.queryByText('Company settings saved.')).not.toBeInTheDocument();
 expect(screen.getByText(/Saved company name:/)).toHaveTextContent(fixture.name);
});
it('restricted company settings do not hide independent own-password security',async()=>{
 m.get.mockImplementation(async(url:string)=>{if(url==='/company/settings')throw {response:{status:403,data:{message:'private SQL'}}};return {data:{data:identity}};});
 mount(<CompanySettingsPage/>);await screen.findByText('Company settings are restricted. Your own account security remains available.');expect(screen.getByRole('link',{name:'Change your password'})).toHaveAttribute('href','/account/security');expect(screen.queryByText('private SQL')).not.toBeInTheDocument();
});
it('unavailable sender and legacy enrollment never offer a verification request or infer verification',async()=>{
 identity.deliveryConfigured=false;const first=mount(<CompanySettingsPage/>);fireEvent.click(screen.getByRole('button',{name:'My account'}));await screen.findByText('Verification email delivery is unavailable. Contact the configured support channel.');expect(screen.queryByRole('button',{name:'Request verification link'})).not.toBeInTheDocument();first.unmount();
 identity.bootstrapRequired=true;mount(<CompanySettingsPage/>);fireEvent.click(screen.getByRole('button',{name:'My account'}));await screen.findByText(/This legacy account needs identity-verified enrollment/);expect(screen.queryByRole('button',{name:'Request verification link'})).not.toBeInTheDocument();
});
it('verification requires current password and receipt says delivery unconfirmed',async()=>{
 mount(<CompanySettingsPage/>);fireEvent.click(screen.getByRole('button',{name:'My account'}));await screen.findByRole('button',{name:'Request verification link'});
 expect(screen.getByLabelText('Current password')).toBeRequired();expect(m.post).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText('Current password'),{target:{value:'old password'}});fireEvent.click(screen.getByRole('button',{name:'Request verification link'}));
 await screen.findByText('Request accepted for processing. Delivery is not confirmed. Check your inbox and spam folder.');expect(m.post).toHaveBeenCalledWith('/owner-identity/email/request',{currentPassword:'old password'});expect(screen.queryByText('Owner email is verified.')).not.toBeInTheDocument();
});
it('public recovery uses the narrow flow shell and gives the neutral owner-account receipt',async()=>{
 const {container}=mount(<OwnerRecoveryPage/>,null);expect(container.querySelector('.flow-shell')).toBeInTheDocument();expect(container.querySelector('.flow-stage')).toHaveAttribute('data-size','narrow');expect(container.querySelector('.v5-auth-page')).not.toBeInTheDocument();expect(screen.getByText(/Managers and staff should ask their company owner/)).toBeInTheDocument();fireEvent.change(screen.getByLabelText('Owner email'),{target:{value:'unknown@example.invalid'}});fireEvent.click(screen.getByRole('button',{name:'Request recovery link'}));
 await screen.findByText('If that email has an owner account, a reset link is on its way.');expect(screen.getByRole('status')).toHaveClass('flow-notice-ok');expect(m.post).toHaveBeenCalledWith('/owner-identity/recovery/request',{email:'unknown@example.invalid'});
});
it('missing sender is honest and does not leak arbitrary server errors',async()=>{
 m.post.mockRejectedValue({response:{status:503,data:{message:'private provider key'}}});mount(<OwnerRecoveryPage/>,null);
 fireEvent.change(screen.getByLabelText('Owner email'),{target:{value:'owner@example.invalid'}});fireEvent.click(screen.getByRole('button',{name:'Request recovery link'}));await screen.findByRole('alert');expect(screen.getByRole('alert')).toHaveTextContent('Email recovery is unavailable.');expect(screen.queryByText('private provider key')).not.toBeInTheDocument();
});
it('verify link GET/render never consumes; explicit confirmation posts token and clears all private caches and identity',async()=>{
 const {store,query}=mount(<OwnerLinkPage kind="verify"/>);expect(m.post).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Confirm owner email'}));await screen.findByRole('heading',{name:'Sign in again'});
 expect(m.post).toHaveBeenCalledWith('/owner-identity/email/complete',{token:'a'.repeat(43)});expect(store.getState().auth.user).toBeNull();expect(query.getQueryData(['private-operational-data'])).toBeUndefined();expect(query.getQueryData(['currentUser'])).toBeNull();expect(m.forget).toHaveBeenCalled();
});
it('expired or used recovery link is explicit and does not navigate to fake success',async()=>{
 m.post.mockRejectedValue({response:{status:400}});mount(<OwnerLinkPage kind="reset"/>,null);
 fireEvent.change(screen.getByLabelText('New password'),{target:{value:'next password'}});fireEvent.change(screen.getByLabelText('Confirm new password'),{target:{value:'next password'}});fireEvent.click(screen.getByRole('button',{name:'Reset password'}));await screen.findByText('This link is invalid, expired or already used. Request a new link.');expect(screen.queryByText('Sign in again')).not.toBeInTheDocument();expect(screen.getByRole('link',{name:'Request recovery link'})).toHaveAttribute('href','/recover-owner-account');
});
it('missing token cannot submit any completion request',()=>{
 m.token.mockReturnValue(undefined);mount(<OwnerLinkPage kind="verify"/>,null);expect(screen.getByRole('alert')).toHaveTextContent('This link is missing or invalid.');expect(m.post).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'Confirm owner email'})).not.toBeInTheDocument();
});
it('own password requires current password, preserves failed draft, and supports forced security independently of company reads',async()=>{
 m.post.mockRejectedValueOnce({response:{status:403}});mount(<OwnSecurityPage forced/>,null);expect(m.get).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText('Current password'),{target:{value:'wrong password'}});fireEvent.change(screen.getByLabelText('New password'),{target:{value:'new password'}});fireEvent.change(screen.getByLabelText('Confirm new password'),{target:{value:'new password'}});fireEvent.click(screen.getByRole('button',{name:'Change password'}));await screen.findByRole('alert');expect(screen.getByLabelText('New password')).toHaveValue('new password');
 fireEvent.change(screen.getByLabelText('Current password'),{target:{value:'correct password'}});fireEvent.click(screen.getByRole('button',{name:'Change password'}));await screen.findByRole('heading',{name:'Sign in again'});expect(m.post).toHaveBeenLastCalledWith('/common/security/password',{currentPassword:'correct password',newPassword:'new password'});
});
it('mismatch and UTF-8 overflow are rejected before the API',async()=>{
 mount(<OwnSecurityPage/>);fireEvent.change(screen.getByLabelText('Current password'),{target:{value:'current'}});fireEvent.change(screen.getByLabelText('New password'),{target:{value:'ش'.repeat(40)}});fireEvent.change(screen.getByLabelText('Confirm new password'),{target:{value:'ش'.repeat(40)}});fireEvent.click(screen.getByRole('button',{name:'Change password'}));await screen.findByRole('alert');expect(m.post).not.toHaveBeenCalled();
});
it('only actual structured password-replacement403 admits forced screen',()=>{
 expect(requiresPasswordChange({response:{status:403,data:{errors:[{code:'PASSWORD_CHANGE_REQUIRED'}]}}})).toBe(true);
 expect(requiresPasswordChange({response:{status:403,data:{message:'Replace your password before continuing'}}})).toBe(false);
 expect(requiresPasswordChange({response:{status:401,data:{errors:[{code:'PASSWORD_CHANGE_REQUIRED'}]}}})).toBe(false);
});
it('Urdu recovery keeps LTR email and complete RTL labels and feedback',async()=>{
 mount(<OwnerRecoveryPage/>,null,'ur');expect(document.documentElement.dir).toBe('rtl');expect(screen.getByLabelText('مالک کی ای میل')).toHaveAttribute('dir','ltr');fireEvent.change(screen.getByLabelText('مالک کی ای میل'),{target:{value:'owner@example.invalid'}});fireEvent.click(screen.getByRole('button',{name:'بحالی کا لنک مانگیں'}));await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('اگر اس ای میل پر مالک کا اکاؤنٹ ہے تو ری سیٹ لنک بھیج دیا گیا ہے۔'));
});

it('principal changes discard verification receipts and never reuse another owner status',async()=>{
 const {store}=mount(<CompanySettingsPage/>);fireEvent.click(screen.getByRole('button',{name:'My account'}));await screen.findByRole('button',{name:'Request verification link'});
 fireEvent.change(screen.getByLabelText('Current password'),{target:{value:'first owner password'}});fireEvent.click(screen.getByRole('button',{name:'Request verification link'}));await screen.findByText('Request accepted for processing. Delivery is not confirmed. Check your inbox and spam folder.');
 m.get.mockImplementation(async(url:string)=>{if(url==='/owner-identity/status')return new Promise(()=>undefined);return {data:{data:fixture}};});
 await act(async()=>{store.dispatch(setUser({id:8,role:'ADMIN',name:'Second synthetic owner',email:'second@example.invalid',companyId:99}));});
 expect(screen.queryByText('Request accepted for processing. Delivery is not confirmed. Check your inbox and spam folder.')).not.toBeInTheDocument();expect(screen.getByText('Loading owner verification…')).toBeInTheDocument();expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
});

it('settings sections expose real profile and existing password form while retaining organization draft',async()=>{
 mount(<CompanySettingsPage/>);const name=await screen.findByLabelText('Company name');
 fireEvent.change(name,{target:{value:'Unsaved organization draft'}});
 fireEvent.click(screen.getByRole('button',{name:'My account'}));
 expect(screen.getByRole('heading',{name:'My account'})).toBeVisible();
 expect(screen.getByText('Synthetic account')).toBeVisible();expect(screen.getByText('fixture@example.invalid')).toHaveAttribute('dir','ltr');
 fireEvent.click(screen.getByRole('button',{name:'Security'}));
 expect(screen.getByLabelText('New password')).toBeVisible();expect(screen.getByRole('heading',{name:'Session security'})).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Organization'}));expect(screen.getByLabelText('Company name')).toHaveValue('Unsaved organization draft');
});
it('reload after conflict consumes the new saved version and replaces only after a successful reload',async()=>{
 m.patch.mockRejectedValueOnce({response:{status:409}});mount(<CompanySettingsPage/>);
 fireEvent.change(await screen.findByLabelText('Company name'),{target:{value:'Conflicting draft'}});fireEvent.click(screen.getByRole('button',{name:'Save company name'}));
 await screen.findByRole('alert');
 m.get.mockResolvedValueOnce({data:{data:{...fixture,name:'Other owner saved',accountVersion:4}}});
 fireEvent.click(screen.getByRole('button',{name:'Reload saved settings'}));await waitFor(()=>expect(screen.getByLabelText('Company name')).toHaveValue('Other owner saved'));
 fireEvent.change(screen.getByLabelText('Company name'),{target:{value:'Save after refresh'}});fireEvent.click(screen.getByRole('button',{name:'Save company name'}));
 await screen.findByText('Company settings saved.');expect(m.patch).toHaveBeenLastCalledWith('/company/settings',{name:'Save after refresh',expectedVersion:4});
});
it('trimmed empty organization names are rejected without a mutation',async()=>{
 mount(<CompanySettingsPage/>);fireEvent.change(await screen.findByLabelText('Company name'),{target:{value:'   '}});fireEvent.click(screen.getByRole('button',{name:'Save company name'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Enter a company name between 2 and 160 characters.');expect(m.patch).not.toHaveBeenCalled();
});
it('Urdu settings tabs and profile facts use RTL with an isolated account email',async()=>{
 mount(<CompanySettingsPage/>,'ADMIN','ur');expect(document.documentElement.dir).toBe('rtl');
 fireEvent.click(screen.getByRole('button',{name:'میرا اکاؤنٹ'}));expect(screen.getByText('fixture@example.invalid')).toHaveAttribute('dir','ltr');expect(screen.getByRole('heading',{name:'میرا اکاؤنٹ'})).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'سکیورٹی'}));expect(screen.getByLabelText('موجودہ پاس ورڈ')).toHaveAttribute('dir','ltr');
});
it('inline settings password completion revokes identity and private cache through the existing security flow',async()=>{
 const {store,query}=mount(<CompanySettingsPage/>);fireEvent.click(screen.getByRole('button',{name:'Security'}));
 fireEvent.change(screen.getByLabelText('Current password'),{target:{value:'current password'}});fireEvent.change(screen.getByLabelText('New password'),{target:{value:'new inline password'}});fireEvent.change(screen.getByLabelText('Confirm new password'),{target:{value:'new inline password'}});
 fireEvent.click(screen.getByRole('button',{name:'Change password'}));await screen.findByRole('heading',{name:'Sign in again'});
 expect(m.post).toHaveBeenCalledWith('/common/security/password',{currentPassword:'current password',newPassword:'new inline password'});expect(store.getState().auth.user).toBeNull();expect(query.getQueryData(['private-operational-data'])).toBeUndefined();
});
it('pending company-name save disables duplicate submission and retains saved facts until receipt',async()=>{
 m.patch.mockImplementationOnce(()=>new Promise(()=>undefined));mount(<CompanySettingsPage/>);
 fireEvent.change(await screen.findByLabelText('Company name'),{target:{value:'Pending company draft'}});fireEvent.click(screen.getByRole('button',{name:'Save company name'}));
 expect(await screen.findByRole('button',{name:'Saving…'})).toBeDisabled();expect(screen.getByText(/Saved company name:/)).toHaveTextContent(fixture.name);expect(m.patch).toHaveBeenCalledTimes(1);expect(screen.queryByText('Company settings saved.')).not.toBeInTheDocument();
});

it('failed saved-settings refresh leaves the current organization draft mounted until successful retry',async()=>{
 mount(<CompanySettingsPage/>);fireEvent.change(await screen.findByLabelText('Company name'),{target:{value:'Keep draft through network failure'}});
 m.get.mockRejectedValueOnce(new Error('network unavailable'));fireEvent.click(screen.getByRole('button',{name:'Reload saved settings'}));
 await screen.findByText('Company settings could not load. Your saved records are unchanged.');expect(screen.getByLabelText('Company name')).toHaveValue('Keep draft through network failure');
 m.get.mockResolvedValueOnce({data:{data:{...fixture,name:'Refreshed saved name',accountVersion:4}}});fireEvent.click(screen.getByRole('button',{name:'Reload saved settings'}));
 await waitFor(()=>expect(screen.getByLabelText('Company name')).toHaveValue('Refreshed saved name'));
});

it.each(['verify', 'reset'] as const)('public %s link uses the narrow shell even with a signed-in identity',kind=>{
 const {container}=mount(<OwnerLinkPage kind={kind}/>);
 expect(container.querySelector('.flow-stage')).toHaveAttribute('data-size','narrow');
 expect(container.querySelector('.v5-auth-page')).not.toBeInTheDocument();
 expect(screen.getByRole('heading',{level:1})).toHaveFocus();
 expect(document.title).toBe(`${kind==='verify'?'Verify owner email':'Reset owner password'} | Hygene Ops`);
 expect(screen.getByRole('link',{name:'Return to sign in'})).toHaveAttribute('href','/login');
 expect(m.token).toHaveBeenCalledWith(kind==='verify'?'/verify-owner-email':'/reset-owner-password');
 expect(m.post).not.toHaveBeenCalled();
});
it.each(['verify', 'reset'] as const)('missing %s link explains how to continue',kind=>{
 m.token.mockReturnValue(undefined);const {container}=mount(<OwnerLinkPage kind={kind}/>,null);
 expect(container.querySelector('.flow-shell')).toBeInTheDocument();
 expect(screen.getByRole('alert')).toHaveTextContent('Open the complete link from your email.');
 expect(screen.getByRole('link',{name:kind==='reset'?'Request recovery link':'Open company settings'})).toHaveAttribute('href',kind==='reset'?'/recover-owner-account':'/settings');
 expect(m.post).not.toHaveBeenCalled();
});
it('rejected verification offers company settings for a replacement link',async()=>{
 m.post.mockRejectedValue({response:{status:410}});mount(<OwnerLinkPage kind="verify"/>,null);
 fireEvent.click(screen.getByRole('button',{name:'Confirm owner email'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('This link is invalid, expired or already used. Request a new link.');
 expect(screen.getByRole('link',{name:'Open company settings'})).toHaveAttribute('href','/settings');
 expect(screen.queryByText('Sign in again')).not.toBeInTheDocument();
});
it.each([false,true])('own security preserves its existing auth layout (forced: %s)',forced=>{
 const {container}=mount(<OwnSecurityPage forced={forced}/>);
 expect(container.querySelector('.workspace.account-public .v5-auth-page')).toBeInTheDocument();
 expect(container.querySelector('.flow-shell')).not.toBeInTheDocument();
 expect(screen.getByLabelText('Current password').closest('form')).toHaveClass('account-form');
 expect(screen.getByRole('button',{name:'Change password'})).not.toHaveClass('flow-button');
});
it('company settings retain their settings layout and forms',async()=>{
 const {container}=mount(<CompanySettingsPage/>);await screen.findByLabelText('Company name');
 expect(screen.getByRole('region',{name:'Organization details'})).toBeVisible();
 expect(container.querySelector('.flow-shell')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Security'}));
 expect(screen.getByLabelText('Current password').closest('form')).toHaveClass('account-form');
});
it('reset completion still posts the captured token and new password and revokes private session state',async()=>{
 const {store,query}=mount(<OwnerLinkPage kind="reset"/>,null);
 fireEvent.change(screen.getByLabelText('New password'),{target:{value:'replacement password'}});
 fireEvent.change(screen.getByLabelText('Confirm new password'),{target:{value:'replacement password'}});
 fireEvent.click(screen.getByRole('button',{name:'Reset password'}));
 await screen.findByRole('heading',{name:'Sign in again'});
 expect(m.post).toHaveBeenCalledWith('/owner-identity/recovery/complete',{token:'a'.repeat(43),newPassword:'replacement password'});
 expect(store.getState().auth.user).toBeNull();expect(query.getQueryData(['private-operational-data'])).toBeUndefined();expect(m.forget).toHaveBeenCalled();
});
