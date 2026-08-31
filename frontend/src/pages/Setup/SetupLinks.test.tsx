import {configureStore} from '@reduxjs/toolkit';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {fireEvent,render,screen} from '@testing-library/react';
import {Provider} from 'react-redux';
import {MemoryRouter,useLocation} from 'react-router-dom';
import {expect,it,vi} from 'vitest';
import authReducer,{setUser} from '@/store/slices/authSlice';
import {LanguageProvider} from '@/i18n/LanguageProvider';
import LocationsPage from '../Location/LocationsPage';
import StaffPage from '../Staff/StaffPage';
import LocationTemplatesTab from '../Location/components/LocationTemplatesTab';
vi.mock('../Location/queries',()=>({useGetLocations:()=>({isPending:false,isError:false,data:{data:[{id:20,name:'Synthetic assigned site',address:'Fixture',isActive:true,timezone:'Asia/Karachi',_count:{staff:0,taskTemplates:0}}]}})}));
vi.mock('../Manager/operations',async original=>({...await original<typeof import('../Manager/operations')>(),useOperations:()=>({data:{comparison:[]},isError:false})}));
vi.mock('../Staff/queries',()=>({useGetStaff:()=>({isLoading:false,isError:false,data:{data:[]}}),useDeleteStaff:()=>({}),useEditStaff:()=>({}),getStaffDetailsQueryOptions:()=>({})}));
vi.mock('../Assignment/queries',()=>({useAssignStaffToLocation:()=>({}),useAssignStaffToTemplate:()=>({})}));
vi.mock('../Task/queries',()=>({useDeleteTaskTemplate:()=>({}),useEditTaskTemplate:()=>({})}));
vi.mock('../Area/queries',()=>({useAreas:()=>({data:[]})}));
// Existing dialogs have their own behavior contracts. These seams prove actual
// incumbent page URL state and exact selected-site handoff, not another form.
vi.mock('../Location/LocationFormDialog',()=>({default:({open,onOpenChange}:{open:boolean;onOpenChange:(open:boolean)=>void})=>open?<div role="dialog" aria-label="Existing location form"><button onClick={()=>onOpenChange(false)}>Close existing form</button></div>:null}));
vi.mock('../Staff/StaffCreateDialog',()=>({default:({open,location,onOpenChange}:{open:boolean;location?:{name:string};onOpenChange:(open:boolean)=>void})=>open?<div role="dialog" aria-label="Existing team form"><p>{location?.name}</p><button onClick={()=>onOpenChange(false)}>Close existing form</button></div>:null}));
vi.mock('../Task/components/TaskScheduleWizard',()=>({default:({open,locationId,onOpenChange}:{open:boolean;locationId:number;onOpenChange:(open:boolean)=>void})=>open?<div role="dialog" aria-label="Existing schedule wizard"><p>Site {locationId}</p><button onClick={()=>onOpenChange(false)}>Close existing form</button></div>:null}));
function Path(){return <output aria-label="Current route">{useLocation().search}</output>;}
function mount(node:React.ReactNode,path:string){
 const store=configureStore({reducer:{auth:authReducer}});store.dispatch(setUser({id:1,companyId:42,role:'ADMIN',name:'Synthetic owner',email:'fixture@example.invalid'}));
 render(<Provider store={store}><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><LanguageProvider><MemoryRouter initialEntries={[path]}>{node}<Path/></MemoryRouter></LanguageProvider></QueryClientProvider></Provider>);
}
it('location deep link opens the actual page dialog state and close removes its creation intent',()=>{
 mount(<LocationsPage/>,'/locations?create=1');expect(screen.getByRole('dialog',{name:'Existing location form'})).toBeInTheDocument();fireEvent.click(screen.getByText('Close existing form'));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(screen.getByLabelText('Current route')).not.toHaveTextContent('create');
});
it('team deep link preserves the selected assigned site when opening and closing the existing form',()=>{
 mount(<StaffPage/>,'/staff?locationId=20&create=1');expect(screen.getByRole('dialog',{name:'Existing team form'})).toHaveTextContent('Synthetic assigned site');expect(screen.getByRole('button',{name:'Filter by location: Synthetic assigned site'})).toBeInTheDocument();fireEvent.click(screen.getByText('Close existing form'));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(screen.getByLabelText('Current route')).toHaveTextContent('locationId=20');expect(screen.getByLabelText('Current route')).not.toHaveTextContent('create');
});
it('schedule deep link opens the existing wizard for that site and keeps the tab on close',()=>{
 mount(<LocationTemplatesTab templates={[]} staffList={[]} locationId={20} timeZone="Asia/Karachi" locationName="Synthetic assigned site"/>,'/locations/20?tab=templates&newSchedule=1');expect(screen.getByRole('dialog',{name:'Existing schedule wizard'})).toHaveTextContent('Site 20');fireEvent.click(screen.getByText('Close existing form'));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(screen.getByLabelText('Current route')).toHaveTextContent('tab=templates');expect(screen.getByLabelText('Current route')).not.toHaveTextContent('newSchedule');
});
