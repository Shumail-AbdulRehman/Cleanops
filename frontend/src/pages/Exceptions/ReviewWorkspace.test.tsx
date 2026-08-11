import {useState} from 'react';
import {render,screen,fireEvent,waitFor,within} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {createMemoryRouter,RouterProvider,useSearchParams,Link} from 'react-router-dom';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {LanguageProvider} from '@/i18n/LanguageProvider';
import ProtectedEvidence from '../Verification/ProtectedEvidence';
import DecisionForm from './DecisionForm';
import type {ExceptionDetail} from './types';
const api=vi.hoisted(()=>({get:vi.fn(),post:vi.fn()}));
vi.mock('@/api/client',()=>({client:api}));
const detail:ExceptionDetail={id:3,kind:'TASK',state:'MANAGER_REVIEW',priority:1,rowVersion:2,locationId:8,firstRaisedAt:'2026-10-21T04:00:00Z',updatedAt:'2026-10-21T04:00:00Z',issues:[],allowedActions:[],closureActions:['RESOLVE_REVIEW'],decisions:[],events:[]};
function mount(content:React.ReactNode){const query=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});const router=createMemoryRouter([{path:'/exceptions/:id',element:content}],{initialEntries:['/exceptions/3']});return render(<QueryClientProvider client={query}><LanguageProvider><div className="workspace"><RouterProvider router={router}/></div></LanguageProvider></QueryClientProvider>);}
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();api.post.mockResolvedValue({data:{data:{}}});vi.stubGlobal('IntersectionObserver',class{callback:(entries:{isIntersecting:boolean}[])=>void;constructor(callback:(entries:{isIntersecting:boolean}[])=>void){this.callback=callback;}observe(){this.callback([{isIntersecting:true}]);}disconnect(){}});vi.stubGlobal('URL',class extends URL{static createObjectURL=vi.fn(()=> 'blob:synthetic-private');static revokeObjectURL=vi.fn();});});
afterEach(()=>vi.unstubAllGlobals());
it('loads private thumbnails without nesting an interactive viewer in the selection button',async()=>{api.get.mockResolvedValue({data:new Blob(['synthetic'])});mount(<button type="button" aria-label="Choose photo"><ProtectedEvidence assetId="private" privacyState="SAFE" variant="thumbnail" alt="Synthetic evidence"/></button>);const image=await screen.findByRole('img',{name:'Synthetic evidence'});expect(image).toHaveAttribute('src','blob:synthetic-private');expect(screen.getAllByRole('button')).toHaveLength(1);expect(api.get).toHaveBeenCalledWith('/evidence/private/content',expect.objectContaining({responseType:'blob',params:{variant:'review'}}));});
it('supports bounded inline zoom, fit and an accessible enlarged viewer',async()=>{api.get.mockResolvedValue({data:new Blob(['synthetic'])});const view=mount(<ProtectedEvidence assetId="private" privacyState="SAFE" variant="workspace" alt="Synthetic evidence"/>);await screen.findByRole('img',{name:'Synthetic evidence'});expect(screen.getByRole('region',{name:'Photo inspection area'})).toHaveAttribute('tabindex','0');expect(screen.getByRole('button',{name:'Zoom out'})).toBeDisabled();for(let i=0;i<6;i++)fireEvent.click(screen.getByRole('button',{name:'Zoom in'}));expect(screen.getByRole('status',{name:'Photo zoom'})).toHaveTextContent('300%');expect(screen.getByRole('button',{name:'Zoom in'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Fit'}));expect(screen.getByRole('status',{name:'Photo zoom'})).toHaveTextContent('100%');fireEvent.click(screen.getByRole('button',{name:'Enlarge photo'}));const dialog=screen.getByRole('dialog');expect(within(dialog).getByRole('img')).toHaveAttribute('src','blob:synthetic-private');view.unmount();expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-private');});
function Draft(){const [,setParams]=useSearchParams();return <><button onClick={()=>setParams({requirementId:'another-view'})}>Inspect another view</button><Link to="/exceptions/4">Next case</Link><DecisionForm detail={detail} onDone={async()=>{}}/></>;}
it('keeps the decision note when inspecting another photo and guards leaving the review',()=>{mount(<Draft/>);fireEvent.change(screen.getByRole('textbox',{name:'Resolution note'}),{target:{value:'Keep this decision draft'}});fireEvent.click(screen.getByRole('button',{name:'Inspect another view'}));expect(screen.queryByText(/You have an unsaved note/)).not.toBeInTheDocument();expect(screen.getByRole('textbox',{name:'Resolution note'})).toHaveValue('Keep this decision draft');fireEvent.click(screen.getByRole('link',{name:'Next case'}));expect(screen.getByRole('alert')).toHaveTextContent('You have an unsaved note');fireEvent.click(screen.getByRole('button',{name:'Stay here'}));expect(screen.getByRole('textbox',{name:'Resolution note'})).toHaveValue('Keep this decision draft');});
function Conflict({refresh}:{refresh:boolean}){const [version,setVersion]=useState(2);return <DecisionForm detail={{...detail,rowVersion:version}} onDone={async()=>{if(refresh)setVersion(3);}}/>;}
it.each([false,true])('retains draft after a conflict and allows saving only after a new server version (refresh=%s)',async refresh=>{api.post.mockRejectedValue({response:{status:409}});mount(<Conflict refresh={refresh}/>);fireEvent.change(screen.getByRole('textbox',{name:'Resolution note'}),{target:{value:'Conflict draft retained'}});fireEvent.click(screen.getByRole('button',{name:'Confirm resolution'}));await screen.findByText('This review changed. Refresh before saving. Your note is kept.');expect(screen.getByRole('button',{name:'Confirm resolution'})).toBeDisabled();fireEvent.click(screen.getByRole('radio',{name:'Resolve review'}));expect(screen.getByRole('button',{name:'Refresh review'})).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Refresh review'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Confirm resolution'})).toHaveProperty('disabled',!refresh));expect(screen.getByRole('textbox',{name:'Resolution note'})).toHaveValue('Conflict draft retained');if(refresh)expect(screen.queryByRole('alert')).not.toBeInTheDocument();});
it('shows retry feedback if authenticated content cannot decode as an image',async()=>{api.get.mockResolvedValue({data:new Blob(['invalid-image'])});mount(<ProtectedEvidence assetId="private" privacyState="SAFE" variant="workspace" alt="Synthetic evidence"/>);fireEvent.error(await screen.findByRole('img',{name:'Synthetic evidence'}));expect(screen.getByRole('alert')).toHaveTextContent('Evidence could not load. Retry when connected.');expect(screen.getByRole('button',{name:'Retry'})).toBeInTheDocument();expect(screen.queryByRole('img')).not.toBeInTheDocument();});

it('shows the saved closure note, attribution and local time without allowing another decision',()=>{
 const closed={...detail,state:'RESOLVED',location:{id:8,name:'Synthetic site',timezone:'Asia/Karachi'},decisions:[{id:7,action:'RESOLVE_REVIEW',reasonCode:'MANAGER_RESOLVED',note:'Checked the saved records\nNo staff issue recorded',createdAt:'2026-10-21T04:10:00Z',actorManager:{name:'Recorded manager'}}]};
 mount(<DecisionForm detail={closed} onDone={async()=>{}}/>);
 const panel=screen.getByRole('region',{name:'Decision recorded'});
 expect(within(panel).getByText('Recorded manager')).toBeInTheDocument();
 expect(within(panel).getByText(/Checked the saved records/)).toHaveTextContent('No staff issue recorded');
 expect(panel.querySelector('time')).toHaveAttribute('dateTime','2026-10-21T04:10:00Z');
 expect(panel).toHaveTextContent('Asia/Karachi');
 expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Confirm resolution'})).not.toBeInTheDocument();
 expect(screen.queryByText('Verified completion recorded')).not.toBeInTheDocument();
});
it('does not invent a closure actor or note when a closed historical record has no saved details',()=>{
 mount(<DecisionForm detail={{...detail,state:'RESOLVED',decisions:[]}} onDone={async()=>{}}/>);
 expect(screen.getByRole('status')).toHaveTextContent('Review closed; decision details unavailable');
 expect(screen.queryByText('Saved note')).not.toBeInTheDocument();
 expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});
it('renders a deliberate performance closure as its recorded outcome without an automatic verification claim',()=>{
 localStorage.setItem('hygene-ops.language','ur');
 mount(<DecisionForm detail={{...detail,state:'RESOLVED',decisions:[{id:8,action:'RECORD_PERFORMANCE_ISSUE',reasonCode:'MANAGER_PERFORMANCE_RECORDED',note:'Saved synthetic performance context',createdAt:'2026-10-21T04:10:00Z'}]}} onDone={async()=>{}}/>);
 expect(document.documentElement.dir).toBe('rtl');
 expect(screen.getByRole('status')).toHaveTextContent('عملے کی کارکردگی کا مسئلہ درج ہوا');
 expect(screen.getByText('مینیجر کا نام دستیاب نہیں')).toBeInTheDocument();
 expect(screen.getByText('Saved synthetic performance context')).toBeInTheDocument();
});
it('explains intentional setup-only records instead of claiming their decisions failed to load',()=>{
 mount(<DecisionForm detail={{...detail,kind:'SETUP',closureActions:[]}} onDone={async()=>{}}/>);
 expect(screen.getByRole('status')).toHaveTextContent('No staff decision is available for this setup record.');
 expect(screen.queryByText('Review decisions could not be loaded. Refresh the page to continue.')).not.toBeInTheDocument();
 expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

it('retries a failed protected request and never retains a public image URL',async()=>{
 api.get.mockRejectedValueOnce({response:{status:503}}).mockResolvedValueOnce({data:new Blob(['synthetic-private-image'])});
 mount(<ProtectedEvidence assetId="private-retry" privacyState="SAFE" variant="workspace" alt="Private retry fixture"/>);
 await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'Retry'}));
 expect(await screen.findByRole('img',{name:'Private retry fixture'})).toHaveAttribute('src','blob:synthetic-private');
 expect(api.get).toHaveBeenCalledTimes(2);
 for(const [,options] of api.get.mock.calls)expect(options).toEqual(expect.objectContaining({responseType:'blob',params:{variant:'review'}}));
});
it.each([401,403])('keeps denied closure drafts and gives localized recovery without raw server text (%s)',async status=>{
 localStorage.setItem('hygene-ops.language','ur');api.post.mockRejectedValue({response:{status,data:{message:'Internal untranslated authorization detail'}}});
 mount(<DecisionForm detail={detail} onDone={async()=>{}}/>);
 const note=screen.getByRole('textbox');fireEvent.change(note,{target:{value:'Synthetic retained note'}});fireEvent.submit(note.closest('form')!);
 expect(await screen.findByRole('alert')).toHaveTextContent('آپ کو اس جائزے کا فیصلہ محفوظ کرنے کی اجازت نہیں');
 expect(note).toHaveValue('Synthetic retained note');expect(screen.queryByText('Internal untranslated authorization detail')).not.toBeInTheDocument();
});
it('uses the same request identity when retrying an uncertain closure result',async()=>{
 api.post.mockRejectedValueOnce(new Error('Synthetic lost response')).mockResolvedValueOnce({data:{data:{}}});
 mount(<DecisionForm detail={detail} onDone={async()=>{}}/>);
 const note=screen.getByRole('textbox',{name:'Resolution note'});fireEvent.change(note,{target:{value:'Same retained decision after uncertain response'}});
 fireEvent.submit(note.closest('form')!);await screen.findByRole('alert');expect(note).toHaveValue('Same retained decision after uncertain response');
 fireEvent.submit(note.closest('form')!);await waitFor(()=>expect(api.post).toHaveBeenCalledTimes(2));
 expect(api.post.mock.calls[1]).toEqual(api.post.mock.calls[0]);
});

it('returns keyboard focus to the photo control when the enlarged viewer closes',async()=>{
 api.get.mockResolvedValue({data:new Blob(['synthetic-private-image'])});
 mount(<ProtectedEvidence assetId="focus-fixture" privacyState="SAFE" variant="workspace" alt="Synthetic focus fixture"/>);
 await screen.findByRole('img',{name:'Synthetic focus fixture'});
 const opener=screen.getByRole('button',{name:'Enlarge photo'});opener.focus();fireEvent.click(opener);
 const dialog=screen.getByRole('dialog');fireEvent.click(within(dialog).getByRole('button',{name:'Close'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());expect(opener).toHaveFocus();
});
