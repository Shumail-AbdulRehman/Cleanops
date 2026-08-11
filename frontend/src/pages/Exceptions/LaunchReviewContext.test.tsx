import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import authReducer, { setUser } from '@/store/slices/authSlice';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { reviewUrdu } from '@/i18n/reviewTranslations';
import LaunchReviewContext from './LaunchReviewContext';
import ExceptionDetailPage from './ExceptionDetailPage';
import ExceptionInboxPage from './ExceptionInboxPage';
import ProtectedEvidence from '../Verification/ProtectedEvidence';
import { requirementDiagnosis } from './reviewDiagnosis';
import type { ExceptionDetail } from './types';
const api = vi.hoisted(() => ({get:vi.fn(),post:vi.fn()}));
vi.mock('@/api/client', () => ({client:api}));
const replacement={policyEligible:true,available:false,reason:'PHOTO_QUALIFICATION_UNAVAILABLE',policyReason:'STAFF_CAPTURE_FLOW_REQUIRED',processingAllowed:false,automaticApproval:false};
const attempt={id:'attempt',state:'REVIEW_REQUIRED',mediaAssetId:null,privacyState:'SAFE',receivedAt:'2026-10-21T04:00:00Z',createdAt:'2026-10-21T04:00:00Z',reviewSummary:{reasonCode:'SERVICE_FAILURE',cleanliness:null,dirtySurfaces:[],missingSurfaces:[]}};
const fixture = ():ExceptionDetail => ({id:3,kind:'TASK',state:'MANAGER_REVIEW',priority:1,rowVersion:2,locationId:8,firstRaisedAt:'2026-10-21T04:00:00Z',updatedAt:'2026-10-21T04:00:00Z',location:{id:8,name:'Synthetic site',timezone:'Asia/Karachi'},area:{id:7,name:'Synthetic washroom'},task:{id:2,title:'Synthetic cleaning',status:'IN_PROGRESS',verificationState:'NEEDS_REVIEW',completionOutcome:null,shiftEnd:'2026-10-21T05:00:00Z',staffSubmittedAt:null},items:[{id:1,nameSnapshot:'Synthetic sink',sourceAreaItemId:1,requirements:[{id:'view',viewKey:'BASIN_TAP',state:'REVIEW_REQUIRED',decisionVersion:2,mandatory:true,instructionsSnapshot:'Show the sink',currentAttemptId:attempt.id,currentAttempt:attempt,replacement}]}],issues:[],allowedActions:[],closureActions:['RESOLVE_REVIEW','RECORD_PERFORMANCE_ISSUE'],performanceStaffOptions:[{id:4,name:'Synthetic staff'}],decisions:[],events:[]});
let detail:ExceptionDetail;
function mount(content:React.ReactNode, lang='en', entry='/exceptions/3?requirementId=view') {
 localStorage.setItem('hygene-ops.language',lang);
 const store=configureStore({reducer:{auth:authReducer}});store.dispatch(setUser({id:1,companyId:42,role:'MANAGER',name:'Synthetic reviewer',email:'fixture@example.invalid'}));
 const query=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false}}});
 const router=createMemoryRouter([{path:'/exceptions/:id',element:content}],{initialEntries:[entry]});
 const view=render(<Provider store={store}><QueryClientProvider client={query}><LanguageProvider><div className="workspace"><RouterProvider router={router}/></div></LanguageProvider></QueryClientProvider></Provider>);
 return {...view,query};
}
beforeEach(()=>{
 vi.clearAllMocks();localStorage.clear();detail=fixture();
 api.get.mockImplementation(async(url:string)=>({data:{data:url.endsWith('/next')?{nextId:null}:url==='/verification-exceptions'?{cases:[structuredClone(detail)],page:1,pageSize:20,total:1,totalPages:1,locations:[],queueCounts:{}}:structuredClone(detail)}}));
 api.post.mockResolvedValue({data:{data:{}}});
});
it('separates received photos from unsubmitted work and verification',()=>{
 mount(<LaunchReviewContext detail={detail} replacement={replacement}/>);
 const facts=screen.getByRole('region',{name:'Task and evidence status'});
 expect(facts).toHaveTextContent('1 of 1 current views received');expect(facts).toHaveTextContent('No task submission recorded');expect(facts).toHaveTextContent('No closure decision recorded');expect(facts).toHaveTextContent('Verified completion not recorded');
 expect(facts).toHaveTextContent('new photo checking is unavailable');expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('shows persisted submission without calling it verified',()=>{
 detail.task!.staffSubmittedAt='2026-10-21T04:05:00Z';mount(<LaunchReviewContext detail={detail}/>);
 expect(screen.queryByText('No task submission recorded')).not.toBeInTheDocument();expect(screen.getByText('Verified completion not recorded')).toBeInTheDocument();
});
it('shows attributed saved closure note while preserving unverified outcome',()=>{
 detail.state='RESOLVED';detail.decisions=[{id:2,action:'RESOLVE_REVIEW',reasonCode:'MANAGER_RESOLVED',note:'Synthetic outage investigated',createdAt:'2026-10-21T04:10:00Z',actorManager:{name:'Synthetic reviewer'}}];
 mount(<LaunchReviewContext detail={detail}/>);
 expect(screen.getByText('Synthetic outage investigated')).toBeInTheDocument();expect(screen.getByText(/Synthetic reviewer/)).toBeInTheDocument();expect(screen.getByText('Verified completion not recorded')).toBeInTheDocument();
});
it.each(['COMPLETED_WITH_EXCEPTIONS','LEGACY_RECORDED',null])('does not imply verification from completion outcome %s',outcome=>{
 detail.task!.completionOutcome=outcome;detail.state='RESOLVED';mount(<LaunchReviewContext detail={detail}/>);
 expect(screen.queryByText('Verified completion recorded')).not.toBeInTheDocument();
});
it('uses only the recorded verified completion outcome',()=>{
 detail.task!.completionOutcome='VERIFIED_COMPLETE';mount(<LaunchReviewContext detail={detail}/>);expect(screen.getByText('Verified completion recorded')).toBeInTheDocument();
});
it('keeps missing server qualification information unknown',()=>{
 delete detail.items![0].requirements[0].replacement;mount(<LaunchReviewContext detail={detail}/>);expect(screen.getByRole('status')).toHaveTextContent('Photo service status unavailable');
});
it.each(['SERVICE_FAILURE','PRIVACY_HOLD'])('keeps %s distinct from dirty even if an older requirement label says cleaning',reason=>{
 const r=detail.items![0].requirements[0];r.state='CLEANING_REQUIRED';r.currentAttempt={...attempt,state:reason,privacyState:reason==='PRIVACY_HOLD'?'HOLD':'SAFE',reviewSummary:{...attempt.reviewSummary,reasonCode:reason}};
 const row=requirementDiagnosis(detail,r,'Synthetic sink');expect(row.category).toBe('review');expect(row.title).not.toBe('More cleaning needed');
});
it('wires real parent detail reads and closure POST without restoring retired actions or verifying work',async()=>{
 api.post.mockImplementation(async(url:string,body:unknown)=>{
  if(url.endsWith('/close')){detail={...detail,state:'RESOLVED',rowVersion:3,decisions:[{id:5,action:'RESOLVE_REVIEW',reasonCode:'MANAGER_RESOLVED',note:(body as {note:string}).note,createdAt:'2026-10-21T04:15:00Z',actorManager:{name:'Synthetic reviewer'}}]};}return {data:{data:{}}};
 });
 mount(<ExceptionDetailPage/>);await screen.findByRole('heading',{name:'Task and evidence status'});
 expect(api.get).toHaveBeenCalledWith('/verification-exceptions/3',{params:{}});
 for(const name of ['Ask for another photo','Give more time for photos','Make an exception for this photo','Accept this photo'])expect(screen.queryByRole('button',{name})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('radio',{name:'Resolve review'}));fireEvent.change(screen.getByRole('textbox',{name:'Resolution note'}),{target:{value:'Synthetic reviewed outage'}});fireEvent.click(screen.getByRole('button',{name:'Confirm resolution'}));
 await screen.findAllByText('Synthetic reviewed outage');expect(api.post).toHaveBeenCalledWith('/verification-exceptions/3/close',{requestId:expect.any(String),expectedVersion:2,action:'RESOLVE_REVIEW',note:'Synthetic reviewed outage'});
 expect(screen.getByText('Verified completion not recorded')).toBeInTheDocument();expect(screen.queryByText('Verified complete')).not.toBeInTheDocument();
});
it('preserves closure note on conflict and requires refresh',async()=>{
 api.post.mockImplementation(async(url:string)=>{if(url.endsWith('/close'))throw {response:{status:409}};return {data:{data:{}}};});
 mount(<ExceptionDetailPage/>);await screen.findByRole('radio',{name:'Resolve review'});fireEvent.click(screen.getByRole('radio',{name:'Resolve review'}));fireEvent.change(screen.getByRole('textbox',{name:'Resolution note'}),{target:{value:'Synthetic conflict note'}});fireEvent.click(screen.getByRole('button',{name:'Confirm resolution'}));
 await screen.findByText('This review changed. Refresh before saving. Your note is kept.');expect(screen.getByRole('textbox',{name:'Resolution note'})).toHaveValue('Synthetic conflict note');
});
it('renders denied parent read without retaining private review or fabricated empty state',async()=>{
 api.get.mockRejectedValue({response:{status:403}});mount(<ExceptionDetailPage/>);await waitFor(()=>expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));expect(screen.queryByText('Synthetic sink')).not.toBeInTheDocument();expect(screen.queryByRole('radio',{name:'Resolve review'})).not.toBeInTheDocument();
});
it('never requests held evidence without authorized review mode',()=>{
 mount(<ProtectedEvidence assetId="private" privacyState="HOLD"/>);expect(screen.getByText(/Sensitive image restricted/)).toBeInTheDocument();expect(api.get).not.toHaveBeenCalled();
});
it.each([403,404,503])('uses protected blob API with distinct %i feedback and no public URL',async status=>{
 vi.stubGlobal('IntersectionObserver',class {observe(){this.callback([{isIntersecting:true}]);}disconnect(){}callback:(entries:{isIntersecting:boolean}[])=>void;constructor(callback:(entries:{isIntersecting:boolean}[])=>void){this.callback=callback;}});
 api.get.mockRejectedValue({response:{status}});mount(<ProtectedEvidence assetId="private" privacyState="SAFE"/>);
 const alert=await screen.findByRole('alert');expect(alert).toHaveTextContent(status===403?'You do not have access':status===404?'no longer available':'could not load');
 expect(api.get).toHaveBeenCalledWith('/evidence/private/content',expect.objectContaining({params:{variant:'review'},responseType:'blob'}));expect(within(alert).queryByRole('button',{name:'Retry'})!==null).toBe(status===503);expect(screen.queryByRole('img')).not.toBeInTheDocument();
 vi.unstubAllGlobals();
});
it('renders full workflow vocabulary in Urdu and RTL',()=>{
 mount(<LaunchReviewContext detail={detail} replacement={replacement}/>,'ur');expect(document.documentElement.dir).toBe('rtl');for(const key of ['Task and evidence status','Photos uploaded','Task submitted','Manager reviewed','Evidence verified','Photo replacement'])expect(screen.getByText(reviewUrdu[key])).toBeInTheDocument();
});
it('keeps a missing task distinct from an unsubmitted task',()=>{
 delete detail.task;mount(<LaunchReviewContext detail={detail}/>);expect(screen.getByText('Task submission information unavailable')).toBeInTheDocument();expect(screen.queryByText('No task submission recorded')).not.toBeInTheDocument();
});
it('keeps manager-held evidence behind the same authenticated content endpoint',async()=>{
 vi.stubGlobal('IntersectionObserver',class {callback:(entries:{isIntersecting:boolean}[])=>void;constructor(callback:(entries:{isIntersecting:boolean}[])=>void){this.callback=callback;}observe(){this.callback([{isIntersecting:true}]);}disconnect(){}});
 api.get.mockRejectedValue({response:{status:403}});mount(<ProtectedEvidence assetId="held" privacyState="HOLD" allowRestrictedReview/>);await screen.findByText('You do not have access to this evidence.');expect(api.get).toHaveBeenCalledWith('/evidence/held/content',expect.objectContaining({responseType:'blob',params:{variant:'review'}}));expect(screen.queryByRole('img')).not.toBeInTheDocument();vi.unstubAllGlobals();
});
it('records a deliberate attributed performance issue only through the closure API',async()=>{
 mount(<ExceptionDetailPage/>);await screen.findByRole('radio',{name:'Record staff performance issue'});fireEvent.click(screen.getByRole('radio',{name:'Record staff performance issue'}));
 fireEvent.change(screen.getByRole('combobox',{name:'Performance category'}),{target:{value:'OTHER'}});fireEvent.change(screen.getByRole('textbox',{name:'Performance note'}),{target:{value:'Synthetic circumstances checked'}});fireEvent.click(screen.getByRole('button',{name:'Record issue and close review'}));
 await waitFor(()=>expect(api.post).toHaveBeenCalledWith('/verification-exceptions/3/close',{requestId:expect.any(String),expectedVersion:2,action:'RECORD_PERFORMANCE_ISSUE',staffId:4,category:'OTHER',note:'Synthetic circumstances checked'}));expect(screen.getByText('Verified completion not recorded')).toBeInTheDocument();
});

it('shows queue submission, review closure and verified evidence as separate recorded facts',async()=>{
 detail.task!.staffSubmittedAt='2026-10-21T04:00:00Z';detail.state='RESOLVED';
 mount(<ExceptionInboxPage/>);await screen.findAllByText('Task submitted');expect(within(screen.getByRole('region',{name:'Review queue'})).getByText('Review handled')).toBeInTheDocument();expect(screen.getAllByText('Review closed').length).toBeGreaterThan(0);expect(screen.queryByText('Verified completion recorded')).not.toBeInTheDocument();expect(api.get).toHaveBeenCalledWith('/verification-exceptions',expect.objectContaining({params:expect.objectContaining({queue:'needs-me',page:'1'})}));
});

it('renders persisted setup records with a setup destination and no fabricated staff submission or failed-decision state',async()=>{
 detail.kind='SETUP';delete detail.task;detail.closureActions=[];detail.items=[];
 mount(<ExceptionDetailPage/>);await screen.findByRole('heading',{name:'Room inventory needs setup'});
 expect(screen.getAllByText('No task generated')).toHaveLength(2);
 expect(screen.getByRole('link',{name:'Review room setup'})).toHaveAttribute('href','/locations/8?tab=templates');
 expect(screen.queryByText('Task not submitted')).not.toBeInTheDocument();
 expect(screen.queryByText('Resolve this review, or record a staff performance issue and close it. This task stays in exceptions until you save a decision.')).not.toBeInTheDocument();
 expect(screen.queryByText('Review decisions could not be loaded. Refresh the page to continue.')).not.toBeInTheDocument();
 expect(screen.queryByRole('radio',{name:'Resolve review'})).not.toBeInTheDocument();
});

it('removes earlier queue counts and rows when a failed refresh can no longer confirm them',async()=>{
 api.get.mockImplementation(async(url:string)=>({data:{data:url.endsWith('/next')?{nextId:null}:url==='/verification-exceptions'?{cases:[structuredClone(detail)],page:1,pageSize:20,total:1,totalPages:1,locations:[],queueCounts:{'needs-me':1,resolved:3}}:structuredClone(detail)}}));
 const view=mount(<ExceptionInboxPage/>);await screen.findAllByRole('heading',{name:'Synthetic washroom',level:2});
 expect(screen.getByRole('tab',{name:'Reviewed 3'})).toBeInTheDocument();
 api.get.mockImplementation(async(url:string)=>{if(url==='/verification-exceptions')throw {response:{status:503}};return {data:{data:url.endsWith('/next')?{nextId:null}:structuredClone(detail)}};});
 await act(async()=>{await view.query.invalidateQueries({queryKey:['review-page']});});
 await waitFor(()=>expect(screen.queryByRole('tab',{name:'Reviewed 3'})).not.toBeInTheDocument());
 expect(screen.getByRole('tab',{name:'Reviewed'})).toBeInTheDocument();
 expect(within(screen.getByRole('region',{name:'Review queue'})).getByRole('alert')).toHaveTextContent('This page could not load');
 expect(within(screen.getByRole('region',{name:'Review queue'})).queryByRole('link')).not.toBeInTheDocument();
});

it('offers a real pending review after a closed queue is exhausted instead of looping through reviewed records',async()=>{
 detail.state='RESOLVED';
 api.get.mockImplementation(async(url:string,options?:{params?:{pageSize?:string}})=>({data:{data:url.endsWith('/next')?{nextId:null}:url==='/verification-exceptions'?{cases:options?.params?.pageSize==='1'?[{id:9}]:[structuredClone(detail)],page:1,pageSize:20,total:1,totalPages:1,locations:[],queueCounts:{}}:structuredClone(detail)}}));
 mount(<ExceptionDetailPage/>);
 const decision=await screen.findByRole('region',{name:'Decision recorded'});
 const link=await within(decision).findByRole('link',{name:'Next pending review'});
 expect(link).toHaveAttribute('href',expect.stringContaining('/exceptions/9?returnTo='));
 expect(decodeURIComponent(link.getAttribute('href')!)).toContain('queue=needs-me');
 expect(api.get).toHaveBeenCalledWith('/verification-exceptions',expect.objectContaining({params:expect.objectContaining({queue:'needs-me',page:'1',pageSize:'1'})}));
});

it('uses review vocabulary for Urdu queue tabs without leaking English or task-not-started wording',async()=>{
 mount(<ExceptionInboxPage/>,'ur');
 const queue=await screen.findByRole('tablist',{name:reviewUrdu['Review queues']});
 expect(within(queue).getByRole('tab',{name:reviewUrdu.pending})).toBeInTheDocument();
 expect(within(queue).getByRole('tab',{name:reviewUrdu.reviewed})).toBeInTheDocument();
 expect(within(queue).queryByText('Reviewed')).not.toBeInTheDocument();
 expect(queue).not.toHaveTextContent('شروع نہیں ہوا');
 fireEvent.click(screen.getByRole('button',{name:reviewUrdu['Review filters']}));
 fireEvent.keyDown(screen.getByRole('button',{name:/^جائزے کی فہرست:/}),{key:'ArrowDown'});
 const options=screen.getByRole('menu',{name:'جائزے کی فہرست'});
 expect(within(options).getByRole('menuitemradio',{name:reviewUrdu.pending})).toBeInTheDocument();
 expect(within(options).getByRole('menuitemradio',{name:reviewUrdu.reviewed})).toBeInTheDocument();
});

it('shows replacement eligibility for the issue-selected view, not only a requirement bookmark',async()=>{
 detail.issues=[{id:41,requirementId:'view',reasonCode:'SERVICE_FAILURE',state:'OPEN',occurrences:1,recommendedAction:'REVIEW',firstSeenAt:detail.firstRaisedAt,lastSeenAt:detail.updatedAt,latestAttempt:attempt}];
 mount(<ExceptionDetailPage/>,'en','/exceptions/3?issueId=41');
 await screen.findByRole('heading',{name:'Photo replacement'});
 expect(screen.getByText('This failed view meets the recorded replacement rules, but new photo checking is unavailable. No replacement can be submitted now.')).toBeInTheDocument();
});

it('keeps a decision draft but prevents saving after a detail refresh fails, then recovers',async()=>{
 const view=mount(<ExceptionDetailPage/>);
 const note=await screen.findByRole('textbox',{name:'Resolution note'});
 fireEvent.change(note,{target:{value:'Draft retained while details are unavailable'}});
 api.get.mockImplementation(async(url:string)=>{if(url==='/verification-exceptions/3')throw {response:{status:503}};return {data:{data:url.endsWith('/next')?{nextId:null}:{cases:[structuredClone(detail)],queueCounts:{}}}};});
 await act(async()=>{await view.query.invalidateQueries({queryKey:['exception']});});
 await waitFor(()=>expect(screen.getByRole('button',{name:'Confirm resolution'})).toBeDisabled());
 expect(note).toHaveValue('Draft retained while details are unavailable');
 fireEvent.submit(note.closest('form')!);
 expect(api.post.mock.calls.filter(([url])=>url.endsWith('/close'))).toHaveLength(0);
 api.get.mockImplementation(async(url:string)=>({data:{data:url.endsWith('/next')?{nextId:null}:structuredClone(detail)}}));
 fireEvent.click(screen.getByRole('button',{name:'Refresh review'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Confirm resolution'})).toBeEnabled());
 expect(note).toHaveValue('Draft retained while details are unavailable');
});

it.each([401,403,404])('removes private cached detail after access becomes unavailable (%s)',async status=>{
 const view=mount(<ExceptionDetailPage/>);await screen.findByRole('textbox',{name:'Resolution note'});
 api.get.mockImplementation(async(url:string)=>{if(url==='/verification-exceptions/3')throw {response:{status}};return {data:{data:{nextId:null}}};});
 await act(async()=>{await view.query.invalidateQueries({queryKey:['exception']});});
 await waitFor(()=>expect(screen.queryByRole('textbox',{name:'Resolution note'})).not.toBeInTheDocument());
 expect(screen.queryByText('Synthetic sink')).not.toBeInTheDocument();
 expect(screen.getAllByRole('alert').some(node=>node.textContent?.includes(status===401?'Sign in again':status===403?'access to this review':'Review unavailable'))).toBe(true);
});

it('does not count a local or unconfirmed photo as a server upload receipt',()=>{
 detail.items![0].requirements[0].currentAttempt={...attempt,receivedAt:null,state:'PROCESSING'};
 mount(<LaunchReviewContext detail={detail}/>);
 expect(screen.getByText('0 of 1 current views received')).toBeInTheDocument();
 expect(screen.getByText('No task submission recorded')).toBeInTheDocument();expect(screen.getByText('Verified completion not recorded')).toBeInTheDocument();
});
it.each([
 {processingAllowed:true,available:false,automaticApproval:false,policyEligible:false,policyReason:'CURRENT_SESSION_REQUIRED',message:'No current replacement authority is confirmed for this view.'},
 {processingAllowed:true,available:true,automaticApproval:false,policyEligible:true,policyReason:'FRESH_TASK_QR_REQUIRED',message:'The assigned staff member must clean, then scan the task QR again.'},
 {processingAllowed:true,available:true,automaticApproval:false,policyEligible:true,policyReason:'STAFF_CAPTURE_FLOW_REQUIRED',message:'Replacement is available only through the assigned staff capture flow.'},
])('explains server replacement rules without granting manager authority: $policyReason',value=>{
 mount(<LaunchReviewContext detail={detail} replacement={{...replacement,...value}}/>);
 expect(screen.getByText(new RegExp(value.message.replace(/[.]/g,'\\.')))).toBeInTheDocument();
 expect(screen.queryByRole('button')).not.toBeInTheDocument();expect(screen.queryByText('Verified completion recorded')).not.toBeInTheDocument();
});
