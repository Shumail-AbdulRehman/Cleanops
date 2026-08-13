import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import StaffImportDialog from './StaffImportDialog';
const m=vi.hoisted(()=>({get:vi.fn(),post:vi.fn()}));
vi.mock('@/api/client',()=>({client:{get:m.get,post:m.post}}));
function mount(language='en') {localStorage.setItem('hygene-ops.language',language);const cache=new QueryClient({defaultOptions:{mutations:{retry:false}}});render(<QueryClientProvider client={cache}><LanguageProvider><StaffImportDialog location={{id:3,name:'Centaurus Mall'}}/></LanguageProvider></QueryClientProvider>);}
const preview={total:1,valid:1,token:'signed-preview',location:{name:'Centaurus Mall',timezone:'Asia/Karachi'},rows:[{row:2,name:'Ahmed Khan',email:'ahmed@example.com',phone:'03001234567',start:'22:00',end:'06:00',errors:[]}]};
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();});
afterEach(()=>vi.unstubAllGlobals());
it('opens at selected location, downloads template and cancels',async()=>{mount();fireEvent.click(screen.getByRole('button',{name:'Import Staff'}));expect(screen.getByRole('dialog')).toHaveTextContent('Centaurus Mall');m.get.mockRejectedValue(Error('offline'));fireEvent.click(screen.getByRole('button',{name:'Download Excel Template'}));await waitFor(()=>expect(m.get).toHaveBeenCalledWith('/location/3/staff-import/template',{responseType:'blob'}));expect(await screen.findByRole('alert')).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Cancel'}));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();});
it('previews without creating, confirms the same file and token, and explains SMS sign-in', async () => {
  mount();
  open();
  m.post.mockResolvedValueOnce({data:{data:preview}}).mockResolvedValueOnce({data:{data:{count:1}}});
  const file = upload();
  expect(await screen.findByText('Ahmed Khan')).toBeVisible();
  expect(m.post).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', {name:'Confirm Import'}));
  const message = await screen.findByText('Staff can now sign in with their phone number and a code sent by SMS.');
  expect(message).toBeVisible();
  expect(screen.getByRole('status')).toContainElement(message);
  const [path, body] = m.post.mock.calls[1]!;
  expect(path).toBe('/location/3/staff-import/confirm');
  expect(body.get('file')).toBe(file);
  expect(body.get('token')).toBe('signed-preview');
});
it('displays row errors and disables confirmation',async()=>{mount();fireEvent.click(screen.getByRole('button',{name:'Import Staff'}));m.post.mockResolvedValue({data:{data:{...preview,valid:0,rows:[{...preview.rows[0],errors:['Email is already in use.']}]}}});fireEvent.change(screen.getByLabelText(/Completed spreadsheet/),{target:{files:[new File(['csv'],'staff.csv')]}});expect((await screen.findAllByText('Email is already in use.'))[0]).toBeVisible();expect(screen.getByRole('button',{name:'Confirm Import'})).toBeDisabled();});
it('renders Urdu RTL entry and workflow',()=>{mount('ur');fireEvent.click(screen.getByRole('button',{name:'عملہ درآمد کریں'}));expect(screen.getByRole('dialog')).toHaveAttribute('dir','rtl');expect(screen.getByRole('button',{name:'ایکسل سانچہ ڈاؤن لوڈ کریں'})).toBeVisible();});

it('explains the phone sign-in template and previews phone before email', async () => {
  mount();
  open();
  expect(screen.getByText('Full name, phone, shift start and shift end are required. Email is optional. Staff sign in with their phone number and a code sent by SMS. Format phones as Text and use HH:mm shift times, such as 22:00–06:00.')).toBeVisible();
  m.post.mockResolvedValue({data:{data:preview}});
  upload();
  const person = await screen.findByRole('cell', {name:/Ahmed Khan.*Phone: 03001234567.*Email: ahmed@example\.com/});
  expect(person).toBeVisible();
  expect(screen.queryByRole('columnheader', {name:/password/i})).not.toBeInTheDocument();
  expect(screen.getByRole('dialog')).not.toHaveTextContent(/password/i);
});

it.each(['', null])('shows No email and allows confirmation with email %j', async email => {
  m.post.mockResolvedValue({data:{data:{...preview,rows:[{...preview.rows[0],email}]}}});
  mount();
  open();
  upload();
  expect(await screen.findByText('No email')).toBeVisible();
  expect(screen.getByRole('button', {name:'Confirm Import'})).toBeEnabled();
});

function open() { const trigger=screen.getByRole('button',{name:'Import Staff'});trigger.focus();fireEvent.click(trigger);return trigger; }
function upload(file=new File(['csv'],'staff.csv')) { fireEvent.change(screen.getByLabelText(/Completed spreadsheet/),{target:{files:[file]}});return file; }
function deferred<T>() { let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve}; }

it('downloads the actual template blob as an Excel file',async()=>{
 const create=vi.fn(()=> 'blob:template'), revoke=vi.fn();
 vi.stubGlobal('URL',class extends URL {static createObjectURL=create;static revokeObjectURL=revoke;});
 const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
 const blob=new Blob(['spreadsheet'],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
 m.get.mockResolvedValue({data:blob});mount();open();fireEvent.click(screen.getByRole('button',{name:'Download Excel Template'}));
 await waitFor(()=>expect(click).toHaveBeenCalledOnce());expect(create).toHaveBeenCalledWith(blob);
 const link=click.mock.instances[0] as HTMLAnchorElement;expect(link.download).toBe('staff-template.xlsx');expect(link.href).toBe('blob:template');
});
it('starts without a confirmation or API request until a file is chosen',()=>{
 mount();open();expect(screen.getByRole('button',{name:'Confirm Import'})).toBeDisabled();expect(m.post).not.toHaveBeenCalled();expect(m.get).not.toHaveBeenCalled();
 expect(screen.getByText(/Maximum 500 rows/)).toBeVisible();expect(screen.getByLabelText(/Completed spreadsheet/)).toHaveAttribute('accept','.xlsx,.csv');
});
it('shows a skeleton while checking, blocks dismissal and keeps the exact chosen file',async()=>{
 const response=deferred<{data:{data:typeof preview}}>();m.post.mockReturnValue(response.promise);mount();open();const file=upload();
 expect(await screen.findByText('Checking spreadsheet…')).toBeVisible();expect(screen.getByRole('button',{name:'Confirm Import'})).toBeDisabled();expect(screen.getByRole('button',{name:'Cancel'})).toBeDisabled();expect(screen.getByLabelText(/Completed spreadsheet/)).toBeDisabled();
 fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});fireEvent.click(screen.getByRole('button',{name:'Close'}));expect(screen.getByRole('dialog')).toBeVisible();
 expect(m.post.mock.calls[0]![1].get('file')).toBe(file);await act(async()=>response.resolve({data:{data:preview}}));expect(await screen.findByText('Ahmed Khan')).toBeVisible();
});
it('keeps each field and an explicit ready status in the preview',async()=>{
 m.post.mockResolvedValue({data:{data:preview}});mount();open();upload();const row=await screen.findByRole('row',{name:/Ahmed Khan/});
 for(const value of ['ahmed@example.com','03001234567','22:00–06:00','Ready'])expect(row).toHaveTextContent(value);
 expect(screen.getByText('1 of 1 rows are ready to import.')).toBeVisible();expect(screen.getByRole('button',{name:'Confirm Import'})).toBeEnabled();
});
it('blocks mixed-validity preview confirmation and displays every row error',async()=>{
 const errors=['Email is already in use.','Enter different shift times in HH:mm format.'];
 m.post.mockResolvedValue({data:{data:{...preview,total:2,valid:1,rows:[preview.rows[0],{...preview.rows[0],row:3,name:'Invalid worker',errors}]}}});mount();open();upload();
 const row=await screen.findByRole('row',{name:/Invalid worker/});for(const error of errors)expect(row).toHaveTextContent(error);
 expect(row).toHaveTextContent('Check');fireEvent.click(screen.getByRole('button',{name:'Confirm Import'}));expect(m.post).toHaveBeenCalledTimes(1);
 expect(screen.getByText('Correct the errors and upload the spreadsheet again.')).toBeVisible();
});
it.each([0,501])('blocks confirming a preview with %i employees',async total=>{
 m.post.mockResolvedValue({data:{data:{...preview,total,valid:total,rows:total?[preview.rows[0]]:[]}}});mount();open();upload();await screen.findByRole('heading',{name:'Preview'});expect(screen.getByRole('button',{name:'Confirm Import'})).toBeDisabled();
});
it('keeps all 500 validated employees reachable through preview pagination',async()=>{
 const rows=Array.from({length:500},(_,i)=>({...preview.rows[0],row:i+2,name:'Worker '+i}));
 m.post.mockResolvedValue({data:{data:{...preview,total:500,valid:500,rows}}});mount();open();upload();await screen.findByText('Worker 0');
 expect(screen.getByRole('button',{name:'Confirm Import'})).toBeEnabled();expect(screen.getByText('Page 1 of 25')).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Next'}));expect(screen.getByText('Worker 20')).toBeVisible();expect(screen.getByText('Page 2 of 25')).toBeVisible();
});
it('retries a failed preview without losing the selected file',async()=>{
 m.post.mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce({data:{data:preview}});mount();open();const file=upload();await screen.findByRole('alert');
 expect(screen.getByRole('button',{name:'Confirm Import'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Retry'}));await screen.findByText('Ahmed Khan');
 expect(m.post.mock.calls[1]![0]).toBe('/location/3/staff-import/preview');expect(m.post.mock.calls[1]![1].get('file')).toBe(file);
});
it('replaces an invalid preview when the corrected spreadsheet is uploaded again',async()=>{
 m.post.mockResolvedValueOnce({data:{data:{...preview,valid:0,rows:[{...preview.rows[0],errors:['Email is already in use.']}]}}}).mockResolvedValueOnce({data:{data:preview}});
 mount();open();const file=upload();await screen.findByText('Email is already in use.');upload(file);await screen.findByText('Ready');expect(screen.queryByText('Email is already in use.')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Confirm Import'})).toBeEnabled();
});
it('prevents duplicate confirmation and dismissal while the import is pending',async()=>{
 const result=deferred<{data:{data:{count:number}}}>();m.post.mockResolvedValueOnce({data:{data:preview}}).mockReturnValueOnce(result.promise);mount();open();upload();await screen.findByText('Ahmed Khan');
 const button=screen.getByRole('button',{name:'Confirm Import'});fireEvent.click(button);fireEvent.click(button);await screen.findAllByText('Importing employees…');
 expect(button).toBeDisabled();expect(screen.getByRole('button',{name:'Cancel'})).toBeDisabled();fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});expect(screen.getByRole('dialog')).toBeVisible();expect(m.post).toHaveBeenCalledTimes(2);
 await act(async()=>result.resolve({data:{data:{count:1}}}));expect(await screen.findByText(/Staff can now sign in/)).toBeVisible();
});
it('retries interrupted confirmation with the same file and signed token',async()=>{
 m.post.mockResolvedValueOnce({data:{data:preview}}).mockRejectedValueOnce(Error('interrupted')).mockResolvedValueOnce({data:{data:{count:1}}});mount();open();const file=upload();await screen.findByText('Ahmed Khan');fireEvent.click(screen.getByRole('button',{name:'Confirm Import'}));await screen.findByRole('alert');
 expect(screen.getByText('Ahmed Khan')).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Confirm Import'}));await screen.findByText(/Staff can now sign in/);
 expect(m.post.mock.calls[2]![1].get('file')).toBe(file);expect(m.post.mock.calls[2]![1].get('token')).toBe('signed-preview');expect(m.post.mock.calls.filter(([url])=>url.endsWith('/preview'))).toHaveLength(1);
});
it('shows the server success count, invalidates saved workspace data, and closes with Done',async()=>{
 const invalidate=vi.spyOn(QueryClient.prototype,'invalidateQueries');m.post.mockResolvedValueOnce({data:{data:preview}}).mockResolvedValueOnce({data:{data:{count:7}}});mount();const trigger=open();upload();await screen.findByText('Ahmed Khan');fireEvent.click(screen.getByRole('button',{name:'Confirm Import'}));
 await screen.findByText(/Staff can now sign in/);expect(screen.getByRole('status')).toHaveTextContent('7 employees imported into Centaurus Mall.');expect(invalidate).toHaveBeenCalledOnce();
 fireEvent.click(screen.getByRole('button',{name:'Done'}));await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());expect(trigger).toHaveFocus();open();expect(screen.getByRole('button',{name:'Confirm Import'})).toBeDisabled();
});
it('preserves a checked draft on Cancel and returns keyboard focus to its opener',async()=>{
 m.post.mockResolvedValue({data:{data:preview}});mount();const trigger=open();upload();await screen.findByText('Ahmed Khan');fireEvent.click(screen.getByRole('button',{name:'Cancel'}));await waitFor(()=>expect(trigger).toHaveFocus());open();expect(screen.getByText('Ahmed Khan')).toBeVisible();expect(m.post).toHaveBeenCalledTimes(1);
});
it('translates per-row validation and preserves record data under Urdu',async()=>{
 m.post.mockResolvedValue({data:{data:{...preview,valid:0,rows:[{...preview.rows[0],errors:['Email is already in use.']}]}}});mount('ur');fireEvent.click(screen.getByRole('button',{name:'عملہ درآمد کریں'}));
 fireEvent.change(screen.getByLabelText(/مکمل شیٹ/),{target:{files:[new File(['csv'],'staff.csv')]}});expect(await screen.findByText('ای میل پہلے سے استعمال میں ہے۔')).toBeVisible();expect(screen.getByText('Ahmed Khan')).toBeVisible();expect(screen.getByRole('button',{name:'درآمد کی تصدیق'})).toBeDisabled();expect(screen.getByRole('dialog')).toHaveAttribute('dir','rtl');
});

it('translates phone errors and a missing email in Urdu and preserves unknown errors', async () => {
  const errors = [
    'This phone number is already used.',
    'Duplicate phone in this spreadsheet.',
    'Enter a Pakistan mobile number, like 03001234567.',
    'Unknown row error.',
  ];
  m.post.mockResolvedValue({data:{data:{...preview,valid:0,rows:[{...preview.rows[0],email:null,errors}]}}});
  mount('ur');
  fireEvent.click(screen.getByRole('button', {name:'عملہ درآمد کریں'}));
  fireEvent.change(screen.getByLabelText(/مکمل شیٹ/), {target:{files:[new File(['csv'],'staff.csv')]}});
  const row = await screen.findByRole('row', {name:/Ahmed Khan/});
  expect(row).toHaveTextContent('کوئی ای میل نہیں');
  expect(row).toHaveTextContent('یہ فون نمبر پہلے سے استعمال میں ہے۔');
  expect(row).toHaveTextContent('شیٹ میں فون نمبر دوبارہ درج ہے۔');
  expect(row).toHaveTextContent('پاکستانی موبائل نمبر درج کریں، جیسے 03001234567۔');
  expect(row).toHaveTextContent('Unknown row error.');
});

it('shows the optional Work days column guidance in English', () => {
  mount();
  open();
  expect(screen.getByText('Optional Work days column, for example Mon,Wed. Leave it empty for every day.')).toBeVisible();
});

it('shows the Work days guidance and translates the server row error in Urdu', async () => {
  const errors = ['Enter work days like Mon,Wed using Mon to Sun.'];
  m.post.mockResolvedValue({data:{data:{...preview,valid:0,rows:[{...preview.rows[0],errors}]}}});
  mount('ur');
  fireEvent.click(screen.getByRole('button', {name:'عملہ درآمد کریں'}));
  expect(screen.getByText('کام کے دنوں کا خانہ اختیاری ہے، مثلاً \u2066Mon,Wed\u2069۔ اگر کام ہر روز ہوتا ہے تو اسے خالی چھوڑ دیں۔')).toBeVisible();

  fireEvent.change(screen.getByLabelText(/مکمل شیٹ/), {target:{files:[new File(['csv'],'staff.csv')]}});
  const row = await screen.findByRole('row', {name:/Ahmed Khan/});
  expect(row).toHaveTextContent('کام کے دن \u2066Mon\u2069 سے \u2066Sun\u2069 تک کے مختصر ناموں سے درج کریں، مثلاً \u2066Mon,Wed\u2069۔');
  expect(screen.getByRole('button', {name:'درآمد کی تصدیق'})).toBeDisabled();
});
