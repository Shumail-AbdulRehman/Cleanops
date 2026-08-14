import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import authReducer, { setUser } from '@/store/slices/authSlice';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { WorkspaceTheme } from '@/components/common/WorkspaceTheme';
import TodayStatusPage from './TodayStatusPage';
const m=vi.hoisted(()=>({get:vi.fn()}));
vi.mock('@/api/client',()=>({client:{get:m.get}}));
vi.mock('../Task/components/TaskQr',()=>({default:()=>null}));
const site={id:1,name:'Synthetic site',timezone:'Asia/Karachi'};
const task={id:11,title:'Synthetic cleaning',areaNameSnapshot:'Synthetic room',location:site,locationId:1,shiftStart:'2026-10-20T04:00:00Z',shiftEnd:'2026-10-20T05:00:00Z',status:'PENDING',rawStatus:'PENDING',staffSubmittedAt:null,verificationVersion:2,verificationState:'PENDING',staffId:1,staff:{id:1,name:'Synthetic worker'}};
const summary={locations:[site],days:[{locationId:1,localDate:'2026-10-20',timezone:site.timezone}],asOf:'2026-10-20T03:00:00Z',metrics:{present:2,scheduled:3,totalTasks:5,submitted:1,reviewCount:2,verified:0,accepted:0},chart:{submitted:1,inProgress:1,notStarted:2,overdue:1},attention:[],tasks:[task]};
function mount(path='/today-status',language='en') {
 localStorage.setItem('hygene-ops.language',language);
 const store=configureStore({reducer:{auth:authReducer}});store.dispatch(setUser({id:1,companyId:1,role:'MANAGER',name:'Synthetic manager',email:'manager@example.invalid'}));
 const query=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
 const router=createMemoryRouter([{path:'/today-status',element:<TodayStatusPage/>}],{initialEntries:[path]});
 render(<Provider store={store}><QueryClientProvider client={query}><LanguageProvider><WorkspaceTheme.Provider value={true}><RouterProvider router={router}/></WorkspaceTheme.Provider></LanguageProvider></QueryClientProvider></Provider>);
 return router;
}
beforeEach(()=>{
 localStorage.clear();m.get.mockReset();
 m.get.mockImplementation(async(url:string)=>({data:{data:url.endsWith('/overview')?summary:url.startsWith('/task-instance/')?task:{...summary,rows:[task],total:1,page:2,totalPages:2,pageSize:10}}}));
});
it('shows the scoped API totals and task register; upcoming uses recorded tasks',async()=>{
 mount();await screen.findByRole('heading',{name:'Today, at a glance'});
 expect(await screen.findByRole('img',{name:'2 of 3 scheduled staff checked in'})).toBeInTheDocument();
 expect(screen.getByRole('img',{name:'Work submitted: 1, In progress: 1, Not started: 2, Overdue: 1'})).toBeInTheDocument();
 expect(screen.getByRole('heading',{name:'2 photo reviews need attention'})).toBeInTheDocument();
 expect(screen.getByRole('heading',{name:/Today’s tasks/})).toBeInTheDocument();
 expect(screen.getByRole('link',{name:'Open Photo Reviews'})).toHaveAttribute('href',expect.stringContaining('/exceptions?'));
});
it('status buttons request the backend filter and preserve selected site/date',async()=>{
 const router=mount('/today-status?locationId=1&date=2026-10-20');
 const group=await screen.findByRole('group',{name:'Task status'});
 fireEvent.click(within(group).getByRole('button',{name:/^Overdue/}));
 await waitFor(()=>expect(m.get).toHaveBeenCalledWith('/manager/operations/tasks',expect.objectContaining({params:expect.objectContaining({status:'overdue',locationId:'1',date:'2026-10-20'})})));
 expect(router.state.location.search).toContain('status=overdue');
});
it('opens a task as a named inline region and closing preserves register page and filters',async()=>{
 const router=mount('/today-status?taskId=11&page=2&status=all');
 const dialog=await screen.findByRole('region',{name:'Task details'});
 expect(await within(dialog).findByText('Synthetic room')).toBeInTheDocument();
 fireEvent.click(within(dialog).getByRole('button',{name:'Close details'}));
 await waitFor(()=>expect(screen.queryByRole('region',{name:'Task details'})).not.toBeInTheDocument());
 expect(router.state.location.search).toContain('page=2');expect(router.state.location.search).not.toContain('taskId');
});
it('summary failure is visible and retry reloads actual data instead of displaying zero totals',async()=>{
 let failed=true;m.get.mockImplementation(async(url:string)=>{if(url.endsWith('/overview')&&failed)throw Error('offline');return {data:{data:url.endsWith('/overview')?summary:{...summary,rows:[],total:0,page:1,totalPages:1,pageSize:10}}};});
 mount();expect(await screen.findByRole('alert')).toHaveTextContent('This page could not load');
 expect(screen.queryByRole('heading',{name:'Team attendance'})).not.toBeInTheDocument();
 failed=false;fireEvent.click(within(screen.getByRole('alert')).getByRole('button',{name:'Retry'}));
 expect(await screen.findByRole('heading',{name:'Team attendance'})).toBeInTheDocument();
});
it('renders translated summary, register and review handoff in Urdu',async()=>{
 mount('/today-status','ur');
 expect(await screen.findByRole('heading',{name:'آج کا ایک نظر میں جائزہ'})).toBeInTheDocument();
 expect(await screen.findByRole('heading',{name:'ٹیم کی حاضری'})).toBeInTheDocument();
 expect(screen.getByRole('link',{name:'تصویروں کا جائزہ کھولیں'})).toBeInTheDocument();
 expect(document.documentElement.dir).toBe('rtl');
});
