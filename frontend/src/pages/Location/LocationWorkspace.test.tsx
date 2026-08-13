import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import authReducer, { setUser, type AuthUser } from '@/store/slices/authSlice';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { locationStatsFilter } from './locationStatsFilter';
import LocationsPage from './LocationsPage';
import LocationDetailPage from './LocationDetailPage';
import LocationOverview from './LocationOverview';
import type { UseQueryResult } from '@tanstack/react-query';
import type { OperationOverview } from '../Manager/operations';
const mocks=vi.hoisted(()=>({detailArgs:vi.fn(),templateEdit:vi.fn(),templateAssign:vi.fn(),week:{} as Record<string,unknown>,locations:{} as Record<string,unknown>,detail:{} as Record<string,unknown>,operations:{} as Record<string,unknown>,areas:{} as Record<string,unknown>}));
vi.mock('./queries',()=>({useLocationSchedule:()=>mocks.week,useGetLocations:()=>mocks.locations,useGetLocationById:(id:string,filter:unknown)=>{mocks.detailArgs(id,filter);return mocks.detail;},useDeleteLocation:()=>({mutateAsync:vi.fn()}),useCreateLocation:()=>({}),useUpdateLocation:()=>({})}));
vi.mock('@/pages/Task/queries',()=>({useDeleteTaskTemplate:()=>({mutateAsync:vi.fn()}),useEditTaskTemplate:()=>({mutate:mocks.templateEdit,isPending:false})}));
vi.mock('@/pages/Assignment/queries',()=>({useAssignStaffToTemplate:()=>({mutate:mocks.templateAssign,isPending:false})}));
vi.mock('../Area/queries',()=>({useAreas:()=>mocks.areas}));
vi.mock('../Manager/operations',async importOriginal=>({...await importOriginal<typeof import('../Manager/operations')>(),useOperations:()=>mocks.operations}));
vi.mock('./LocationFormDialog',()=>({default:({open,onOpenChange}:{open:boolean;onOpenChange:(value:boolean)=>void})=>open?<div role="dialog" aria-label="Location editor"><button onClick={()=>onOpenChange(false)}>Cancel editor</button></div>:null}));
vi.mock('../Staff/StaffCreateDialog',()=>({default:()=>null}));
vi.mock('../Area/LocationAreasTab',()=>({default:()=> <p>Area editing boundary</p>}));
vi.mock('./components/LocationTemplatesTab',()=>({default:()=> <p>Schedule editing boundary</p>}));
vi.mock('./components/LocationScheduleTab',()=>({default:()=> <p>Week schedule boundary</p>}));
const site={id:20,name:'Persisted site',address:'Synthetic street',timezone:'Asia/Karachi',radiusMeters:150,latitude:'31.5',longitude:'74.3',isActive:true,status:'ACTIVE',_count:{staff:2,taskTemplates:3},staff:[],taskTemplates:[],taskInstances:[]};
const overview={metrics:{present:4,scheduled:6,totalStaff:7,totalTasks:11,submitted:3,reviewCount:2,verified:1,accepted:0},chart:{submitted:3,inProgress:2,notStarted:4,overdue:2},attention:[],comparison:[{location:site,present:4,scheduled:6,tasks:11,submitted:3,reviews:2}],locations:[site],selected:[site],days:[{locationId:20,localDate:'2026-10-28',timezone:'Asia/Karachi'}],asOf:'2026-10-28T10:30:00Z',date:'today',tasks:[]};
function Path(){return <output aria-label="Current route">{useLocation().pathname+useLocation().search}</output>;}
function mount(node:React.ReactNode,role:AuthUser['role']='ADMIN',path='/locations',language='en'){
 localStorage.setItem('hygene-ops.language',language);
 const store=configureStore({reducer:{auth:authReducer}});store.dispatch(setUser({id:2,companyId:42,role,name:'Fixture owner',email:'owner@example.invalid'}));
 const query=new QueryClient({defaultOptions:{queries:{retry:false}}});
 return render(<Provider store={store}><QueryClientProvider client={query}><LanguageProvider><MemoryRouter initialEntries={[path]}>{node}<Path/></MemoryRouter></LanguageProvider></QueryClientProvider></Provider>);
}
beforeEach(()=>{
 vi.clearAllMocks();localStorage.clear();
 mocks.locations={isPending:false,isError:false,data:{data:[site,{...site,id:21,name:'Archived fixture',isActive:false}]},refetch:vi.fn()};
 mocks.detail={isLoading:false,isFetching:false,isError:false,data:{data:{locationInfo:site,taskStats:[]}},refetch:vi.fn()};
 mocks.operations={isPending:false,isError:false,data:overview,refetch:vi.fn()};
 mocks.areas={isPending:false,isError:false,data:[{id:1,status:'ACTIVE'},{id:2,status:'ARCHIVED'}],refetch:vi.fn()};
});
it('register combines active/archive and search filters using saved records',async()=>{
 mount(<LocationsPage/>);expect(screen.queryByText('Archived fixture')).not.toBeInTheDocument();
 fireEvent.pointerDown(screen.getByRole('button',{name:'Location status: Active locations'}),{button:0,ctrlKey:false,pointerType:'mouse'});fireEvent.click(await screen.findByRole('menuitemradio',{name:'Inactive locations'}));expect(screen.getAllByText('Archived fixture').length).toBeGreaterThan(0);expect(screen.queryByText('Persisted site')).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Search locations'),{target:{value:'not present'}});expect(screen.getByText('No locations match these filters.')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Clear filters'}));expect(screen.getByRole('button',{name:'Location status: Active locations'})).toBeInTheDocument();expect(screen.getByLabelText('Search locations')).toHaveValue('');
});
it('create deep-link opens only for owners and cancelling retains unrelated query context',()=>{
 mount(<LocationsPage/>,'ADMIN','/locations?create=1&from=setup');expect(screen.getByRole('dialog',{name:'Location editor'})).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Cancel editor'}));expect(screen.getByLabelText('Current route')).toHaveTextContent('from=setup');expect(screen.getByLabelText('Current route')).not.toHaveTextContent('create');
});
it('manager cannot open location mutation controls even from a create deep-link',()=>{
 mount(<LocationsPage/>,'MANAGER','/locations?create=1');expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Add location'})).not.toBeInTheDocument();
});
it('failed operational totals never render an all-clear review badge or invented zeros',()=>{
 mocks.operations={isError:true,error:new Error('offline'),refetch:vi.fn()};mount(<LocationsPage/>);expect(screen.getByText('Today’s attendance and task totals are unavailable.')).toBeInTheDocument();expect(screen.queryByText('No open reviews')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Retry'})).toBeInTheDocument();
});
it('denied and loading location reads remain distinct from empty register',()=>{
 mocks.locations={isPending:true};const view=mount(<LocationsPage/>);expect(screen.queryByText('No locations yet. Add your first location to get started.')).not.toBeInTheDocument();view.unmount();mocks.locations={isError:true,error:{response:{status:403}},refetch:vi.fn()};mount(<LocationsPage/>);expect(screen.getByRole('alert')).toHaveTextContent('You do not have access');expect(screen.queryByText('Persisted site')).not.toBeInTheDocument();
});
it('overview uses actual scoped denominators and distinct submission/review counts',()=>{
 mount(<LocationOverview location={site} onTab={vi.fn()} overview={mocks.operations as unknown as UseQueryResult<OperationOverview,Error>}/>);
 const summary=screen.getByRole('region',{name:'Daily summary'});expect(summary).toHaveTextContent('Staff today4 of 6');expect(summary).toHaveTextContent('4 checked in · 2 not checked in');expect(summary).toHaveTextContent('Tasks submitted3 of 11');expect(summary).toHaveTextContent('Waiting for a decision2');expect(screen.getByRole('button',{name:/Area templates/})).toHaveTextContent('1');
 expect(screen.getByRole('link',{name:/Tasks submitted/})).toHaveAttribute('href','/today-status?locationId=20&date=today&tab=tasks');expect(screen.queryByText('Hassan Khan')).not.toBeInTheDocument();
});
it('area read failure stays unknown and preserves the existing navigation action',()=>{
 mocks.areas={isError:true,error:new Error('offline'),refetch:vi.fn()};const tabs=vi.fn();mount(<LocationOverview location={site} onTab={tabs} overview={mocks.operations as unknown as UseQueryResult<OperationOverview,Error>}/>);expect(screen.getByRole('button',{name:/Area templates/})).toHaveTextContent('—');fireEvent.click(screen.getByRole('button',{name:/Area templates/}));expect(tabs).toHaveBeenCalledWith('areas');expect(screen.getByRole('alert')).toBeInTheDocument();
});
it('detail retains URL-driven tabs and hides owner edit for managers',()=>{
 mount(<Routes><Route path="/locations/:id" element={<LocationDetailPage/>}/></Routes>,'MANAGER','/locations/20');expect(screen.queryByRole('button',{name:'Edit location'})).not.toBeInTheDocument();fireEvent.mouseDown(screen.getByRole('tab',{name:'Cleaning schedule'}),{button:0,ctrlKey:false});expect(screen.getByLabelText('Current route')).toHaveTextContent('tab=templates');expect(screen.getByText('Schedule editing boundary')).toBeInTheDocument();
});
it('detail opens the real owner location editor from the V5 heading',()=>{
 mount(<Routes><Route path="/locations/:id" element={<LocationDetailPage/>}/></Routes>,'ADMIN','/locations/20');fireEvent.click(screen.getByRole('button',{name:'Edit location'}));expect(screen.getByRole('dialog',{name:'Location editor'})).toBeInTheDocument();
});
it('Urdu overview translates operational facts without changing saved names or timezone',()=>{
 mount(<LocationOverview location={site} onTab={vi.fn()} overview={mocks.operations as unknown as UseQueryResult<OperationOverview,Error>}/>,'ADMIN','/locations/20','ur');expect(screen.getByRole('heading',{name:'آج اس مقام پر'})).toBeInTheDocument();expect(screen.getByText('4 کی حاضری درج · 2 کی حاضری درج نہیں')).toBeInTheDocument();expect(screen.getByText('Asia/Karachi')).toBeInTheDocument();expect(document.documentElement.dir).toBe('rtl');
});

it('weekly preview remains read-only, translates Urdu controls and keeps site/tab URL context',async()=>{
 const {default:Week}=await vi.importActual<typeof import('./components/LocationScheduleTab')>('./components/LocationScheduleTab');
 const days=Array.from({length:7},(_,i)=>({date:'2026-10-'+(26+i),items:i?[]:[{key:'preview',kind:'planned',instanceId:null,templateId:9,title:'Saved future task',startsAt:'2026-10-26T04:00:00Z',endsAt:'2026-10-26T05:00:00Z',status:null,staff:null,staffMeaning:'unassigned',continuesFromPreviousDay:false,continuesIntoNextDay:false}]}));
 // Use a real calendar week that crosses the month boundary.
 days[5].date='2026-10-31';days[6].date='2026-11-01';
 mocks.week={isPending:false,isError:false,isFetching:false,data:{location:site,weekStart:'2026-10-26',weekEndExclusive:'2026-11-02',days},refetch:vi.fn()};
 mount(<Week locationId="20"/>,'ADMIN','/locations/20?tab=schedule&source=setup','ur');
 expect(screen.getByRole('heading',{name:'ہفتے کا جائزہ'})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:/Saved future task/}));
 expect(screen.getByRole('dialog')).toHaveTextContent('سانچے کا پیش منظر');
 expect(screen.queryByRole('button',{name:'Task QR'})).not.toBeInTheDocument();
 fireEvent.keyDown(document,{key:'Escape'});
 fireEvent.click(screen.getByRole('button',{name:'اگلا ہفتہ'}));
 expect(screen.getByLabelText('Current route')).toHaveTextContent('tab=schedule');
 expect(screen.getByLabelText('Current route')).toHaveTextContent('source=setup');
 expect(screen.getByLabelText('Current route')).toHaveTextContent('week=2026-11-02');
});

it('history date filters use the saved site day across UTC midnight and DST changes',()=>{
 expect(locationStatsFilter('today','Asia/Karachi',new Date('2026-10-28T20:00:00Z'))).toEqual({type:'range',dateFrom:'2026-10-29',dateTo:'2026-10-29'});
 expect(locationStatsFilter('yesterday','Asia/Karachi',new Date('2026-10-28T20:00:00Z'))).toEqual({type:'range',dateFrom:'2026-10-28',dateTo:'2026-10-28'});
 expect(locationStatsFilter('yesterday','America/New_York',new Date('2026-03-09T04:30:00Z'))).toEqual({type:'range',dateFrom:'2026-03-08',dateTo:'2026-03-08'});
 expect(locationStatsFilter('today','America/Los_Angeles',new Date('2026-01-01T01:00:00Z'))).toEqual({type:'range',dateFrom:'2025-12-31',dateTo:'2025-12-31'});
 expect(locationStatsFilter('today',undefined)).toBeUndefined();
 expect(locationStatsFilter('7days','Asia/Karachi')).toEqual({type:'days',days:7});
});

it('schedule editor retains translated draft on failed save and prevents unsupported unassignment',async()=>{
 const {default:Schedules}=await vi.importActual<typeof import('./components/LocationTemplatesTab')>('./components/LocationTemplatesTab');
 mocks.templateEdit.mockImplementation((_input,callbacks)=>callbacks.onError(new Error('sensitive internal detail')));
 const template={id:8,title:'Saved schedule',staffId:7,staff:{name:'Saved worker'},shiftStart:'2026-10-28T04:00:00Z',shiftEnd:'2026-10-28T05:00:00Z',recurringType:'DAILY' as const,isActive:true};
 mount(<Schedules templates={[template]} staffList={[{id:7,name:'Saved worker',email:'worker@example.invalid',shiftStart:template.shiftStart,shiftEnd:template.shiftEnd,isActive:true}]} locationId={20} timeZone="Asia/Karachi" locationName={site.name}/>,'ADMIN','/locations/20?tab=templates','ur');
 fireEvent.click(screen.getByRole('button',{name:/Saved schedule/}));
 fireEvent.click(screen.getByRole('button',{name:'شیڈول بدلیں'}));
 expect(screen.getByRole('dialog',{name:'صفائی کا شیڈول بدلیں'})).toBeInTheDocument();
 expect(screen.getByRole('option',{name:'کوئی مقرر نہیں'})).toBeDisabled();
 expect(screen.getByLabelText('تفصیل')).toBeInTheDocument();expect(screen.getByRole('option',{name:'ایک بار'})).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('شیڈول کا عنوان'),{target:{value:'Preserved schedule draft'}});
 fireEvent.click(screen.getByRole('button',{name:'تبدیلیاں محفوظ کریں'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('آپ کا مسودہ برقرار ہے');
 expect(screen.getByLabelText('شیڈول کا عنوان')).toHaveValue('Preserved schedule draft');
 expect(screen.queryByText('sensitive internal detail')).not.toBeInTheDocument();
 expect(mocks.templateEdit.mock.calls[0][0]).toEqual({id:8,data:{title:'Preserved schedule draft'}});
 expect(mocks.templateAssign).not.toHaveBeenCalled();
});
it('schedule editor blocks duplicate submission until the whole save resolves',async()=>{
 const {default:Schedules}=await vi.importActual<typeof import('./components/LocationTemplatesTab')>('./components/LocationTemplatesTab');
 let finish!:()=>void;mocks.templateEdit.mockImplementation((_input,callbacks)=>{finish=()=>callbacks.onSuccess({});});
 mount(<Schedules templates={[{id:8,title:'Saved schedule',shiftStart:null,shiftEnd:null,isActive:true}]} staffList={[]} locationId={20} timeZone="Asia/Karachi" locationName={site.name}/>);
 fireEvent.click(screen.getByRole('button',{name:/Saved schedule/}));
 fireEvent.click(screen.getByRole('button',{name:'Edit schedule'}));fireEvent.change(screen.getByLabelText('Schedule title'),{target:{value:'Changed title'}});fireEvent.click(screen.getByRole('button',{name:'Save changes'}));
 expect(screen.getByLabelText('Schedule title')).toBeDisabled();expect(screen.getByRole('button',{name:'Saving...'})).toBeDisabled();expect(mocks.templateEdit).toHaveBeenCalledTimes(1);
 await act(async()=>finish());expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('history Today stays enabled after reactive detail resolution and consumes its site timezone',()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-28T20:00:00Z'));
 try{
  const view=mount(<Routes><Route path="/locations/:id" element={<LocationDetailPage/>}/></Routes>,'ADMIN','/locations/20?tab=instances');
  expect(screen.getByRole('button',{name:'Today'})).toBeEnabled();fireEvent.click(screen.getByRole('button',{name:'Today'}));
  expect(mocks.detailArgs).toHaveBeenLastCalledWith('20',{type:'range',dateFrom:'2026-10-29',dateTo:'2026-10-29'});view.unmount();
 }finally{vi.useRealTimers();}
});
it('partial schedule save reports persisted details and retries only the unresolved assignment',async()=>{
 const {default:Schedules}=await vi.importActual<typeof import('./components/LocationTemplatesTab')>('./components/LocationTemplatesTab');
 mocks.templateEdit.mockImplementation((_input,callbacks)=>callbacks.onSuccess({}));
 mocks.templateAssign.mockImplementationOnce((_input,callbacks)=>callbacks.onError(new Error('transport uncertainty'))).mockImplementationOnce((_input,callbacks)=>callbacks.onSuccess({}));
 const staff=[7,8].map(id=>({id,name:'Saved worker '+id,email:'worker'+id+'@example.invalid',shiftStart:null,shiftEnd:null,isActive:true}));
 mount(<Schedules templates={[{id:8,title:'Saved schedule',staffId:7,staff:{name:staff[0].name},shiftStart:null,shiftEnd:null,isActive:true}]} staffList={staff} locationId={20} timeZone="Asia/Karachi" locationName={site.name}/>);
 fireEvent.click(screen.getByRole('button',{name:/Saved schedule/}));
 fireEvent.click(screen.getByRole('button',{name:'Edit schedule'}));fireEvent.change(screen.getByLabelText('Schedule title'),{target:{value:'Persisted details'}});fireEvent.change(screen.getByLabelText('Assigned staff'),{target:{value:'8'}});fireEvent.click(screen.getByRole('button',{name:'Save changes'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Schedule details were saved. Staff assignment could not be confirmed.');expect(screen.getByLabelText('Schedule title')).toHaveValue('Persisted details');expect(mocks.templateEdit).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'Retry staff assignment'}));await act(async()=>{});expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(mocks.templateEdit).toHaveBeenCalledTimes(1);expect(mocks.templateAssign).toHaveBeenCalledTimes(2);
});
