import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '@/api/client';
import { invalidateWorkspace } from '@/lib/invalidateWorkspace';
import { useLanguage } from '@/i18n/context';
import { Check, Download, FileUp } from 'lucide-react';
import SidePanel, { SidePanelFooter } from '@/components/workspace/SidePanel';
import StatusPill from '@/components/workspace/StatusPill';
import { SkeletonRows } from '@/components/common/LoadingSkeleton';
import { Button } from '@/components/ui/button';
import DataTable from '@/components/common/DataTable';
import './staff-import-v6.css';

type Row = { row:number; name:string; email:string|null; phone:string; start:string; end:string; errors:string[] };
type Preview = { total:number; valid:number; rows:Row[]; token:string; location:{name:string;timezone:string} };

const rowErrorsUrdu = new Map([
  ['Unsupported formula, link or cell content.', 'فارمولا، لنک یا مواد قابل قبول نہیں۔'],
  ['Enter a name between 2 and 150 characters.', 'نام ۲ سے ۱۵۰ حروف میں درج کریں۔'],
  ['Enter a valid email.', 'درست ای میل درج کریں۔'],
  ['Enter a valid phone as text, including any leading zero.', 'ابتدائی صفر سمیت درست فون متن میں درج کریں۔'],
  ['Enter different shift times in HH:mm format.', 'شفٹ کے مختلف اوقات HH:mm میں درج کریں۔'],
  ['Duplicate email in this spreadsheet.', 'شیٹ میں ای میل دوبارہ درج ہے۔'],
  ['Email is already in use.', 'ای میل پہلے سے استعمال میں ہے۔'],
  ['Enter a password with at least 6 characters and at most 72 UTF-8 bytes.', 'پاس ورڈ کم از کم ۶ حروف اور زیادہ سے زیادہ ۷۲ UTF-8 بائٹس کا درج کریں۔'],
  ['This phone number is already used.', 'یہ فون نمبر پہلے سے استعمال میں ہے۔'],
  ['Duplicate phone in this spreadsheet.', 'شیٹ میں فون نمبر دوبارہ درج ہے۔'],
  ['Enter a Pakistan mobile number, like 03001234567.', 'پاکستانی موبائل نمبر درج کریں، جیسے 03001234567۔'],
]);

export default function StaffImportDialog({location}:{location:{id:number;name:string}}) {
  const {language,t}=useLanguage(), ur=language==='ur';
  const say=(en:string,urdu:string)=>ur?urdu:t(en);
  const [open,setOpen]=useState(false), [file,setFile]=useState<File|null>(null), [preview,setPreview]=useState<Preview|null>(null), [count,setCount]=useState<number|null>(null);
  const cache=useQueryClient(), busy=useRef(false);
  const base=`/location/${location.id}/staff-import`;
  const previewMutation=useMutation({mutationFn:async(next:File)=>{
    const body=new FormData();body.append('file',next);
    return (await client.post<{data:Preview}>(`${base}/preview`,body)).data.data;
  },onSuccess:setPreview});
  const confirm=useMutation({mutationFn:async()=>{
    if(!file||!preview) return;
    try {
      const body=new FormData();body.append('file',file);body.append('token',preview.token);
      const result=await client.post<{data:{count:number}}>(`${base}/confirm`,body);
      setCount(result.data.data.count);setPreview(null);setFile(null);
      void invalidateWorkspace(cache);
    } finally {busy.current=false;}
  }});
  const template=useMutation({mutationFn:async()=>{
    const response=await client.get(`${base}/template`,{responseType:'blob'});
    const url=URL.createObjectURL(response.data), link=document.createElement('a');
    link.href=url;link.download='staff-template.xlsx';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }});
  const rowError = (message: string) => {
    if (message === 'Enter work days like Mon,Wed using Mon to Sun.') return t(message);
    return ur ? rowErrorsUrdu.get(message) ?? message : message;
  };
  const pending=previewMutation.isPending||confirm.isPending;
  const error=previewMutation.error||confirm.error||template.error;
  const canConfirm=!!file&&!!preview&&preview.total>0&&preview.total<=500&&preview.valid===preview.total&&preview.rows.every(row=>row.errors.length===0);
  const close=(next:boolean)=>{if(!pending&&!busy.current)setOpen(next);};
  const number=(value:number)=>value.toLocaleString(ur?'ur-PK':'en-PK');
  return <>
    <Button type="button" variant="outline" className="wx-staff-import-button" onClick={()=>setOpen(true)}>{say('Import Staff','عملہ درآمد کریں')}</Button>
    <SidePanel wide open={open} onOpenChange={close} title={say('Import Staff','عملہ درآمد کریں')}
      description={`${location.name} · ${say('All employees will be assigned to this location. Use local shift times. Maximum 500 rows, subject to your plan capacity.','تمام ملازمین اسی مقام پر مقرر ہوں گے۔ مقامی شفٹ اوقات درج کریں۔ زیادہ سے زیادہ ۵۰۰ قطاریں، منصوبے کی گنجائش کے مطابق۔')}`}
      footer={<SidePanelFooter className="wx-staff-import-footer">
        {count!==null?<Button type="button" className="wx-staff-import-button wx-staff-import-primary" onClick={()=>{setCount(null);setOpen(false);}}>{say('Done','مکمل')}</Button>:<>
          <Button type="button" variant="outline" className="wx-staff-import-button" disabled={pending} onClick={()=>close(false)}>{say('Cancel','منسوخ')}</Button>
          <Button type="button" className="wx-staff-import-button wx-staff-import-primary" disabled={pending||!canConfirm} aria-busy={confirm.isPending} onClick={()=>{if(canConfirm&&!busy.current){busy.current=true;confirm.mutate();}}}>{confirm.isPending?say('Importing employees…','ملازمین درآمد ہو رہے ہیں…'):say('Confirm Import','درآمد کی تصدیق')}</Button>
        </>}
      </SidePanelFooter>}>
      <div className="wx-staff-import">
        {count!==null?<div role="status" className="wx-staff-import-success">
          <span className="wx-staff-import-success-icon" aria-hidden="true"><Check size={24}/></span>
          <p className="wx-staff-import-result"><bdi>{number(count)}</bdi> {say('employees imported into','ملازمین درآمد ہوئے:')} <bdi>{location.name}</bdi>.</p>
          <p>{say('Staff can now sign in with their phone number and a code sent by SMS.', 'عملہ اب اپنے فون نمبر اور ایس ایم ایس سے ملنے والے کوڈ سے سائن ان کر سکتا ہے۔')}</p>
        </div>:<>
          <section className="wx-staff-import-step" aria-labelledby={`staff-template-${location.id}`}>
            <h3 id={`staff-template-${location.id}`}>{t('Download the template')}</h3>
            <p>{t('Use local shift times.')}</p>
            <Button type="button" variant="outline" className="wx-staff-import-button" disabled={template.isPending||pending} aria-busy={template.isPending} onClick={()=>template.mutate()}><Download size={16} aria-hidden="true"/>{say('Download Excel Template','ایکسل سانچہ ڈاؤن لوڈ کریں')}</Button>
            <p>{say(
              'Full name, phone, shift start and shift end are required. Email is optional. Staff sign in with their phone number and a code sent by SMS. Format phones as Text and use HH:mm shift times, such as 22:00–06:00.',
              'پورا نام، فون نمبر اور شفٹ کے آغاز اور اختتام کے اوقات ضروری ہیں۔ ای میل اختیاری ہے۔ عملہ اپنے فون نمبر اور ایس ایم ایس سے ملنے والے کوڈ سے سائن ان کرتا ہے۔ فون نمبر متن (Text) میں اور شفٹ کے اوقات HH:mm کی صورت میں لکھیں، جیسے 22:00–06:00۔',
            )}</p>
            <p>{t('Optional Work days column, for example Mon,Wed. Leave it empty for every day.')}</p>
          </section>
          <section className="wx-staff-import-step" aria-labelledby={`staff-upload-${location.id}`}>
            <h3 id={`staff-upload-${location.id}`}>{t('Upload your file')}</h3>
            <label htmlFor={`staff-file-${location.id}`}>{say('Completed spreadsheet (.xlsx or .csv, up to 1 MB)','مکمل شیٹ (.xlsx یا .csv، زیادہ سے زیادہ ۱ ایم بی)')}</label>
            <div className="wx-staff-import-upload" aria-disabled={pending}>
              <FileUp size={20} aria-hidden="true"/><span id={`staff-file-name-${location.id}`}>{file?<bdi>{file.name}</bdi>:t('Choose spreadsheet')}</span>
              <input id={`staff-file-${location.id}`} type="file" accept=".xlsx,.csv" aria-describedby={`staff-file-name-${location.id}`} disabled={pending} onChange={event=>{
                const next=event.target.files?.[0]??null;
                if(!next)return;
                setFile(next);setPreview(null);previewMutation.reset();confirm.reset();template.reset();
                previewMutation.mutate(next);
                // Permit choosing the same corrected file after a failed preview.
                event.target.value='';
              }}/>
            </div>
          </section>
          {pending?<div className="wx-staff-import-progress" role="status" aria-live="polite" aria-busy="true">
            <p>{confirm.isPending?say('Importing employees…','ملازمین درآمد ہو رہے ہیں…'):say('Checking spreadsheet…','شیٹ کی جانچ جاری ہے…')}</p>
            {previewMutation.isPending?<div aria-hidden="true"><SkeletonRows count={2}/></div>:null}
          </div>:null}
          {error?<div className="wx-staff-import-error">
            <p role="alert">{say('Could not complete this step. Check the file, assigned location and plan capacity. Preview again if it expired. If confirmation was interrupted, retry the same file to check its saved result.','یہ مرحلہ مکمل نہیں ہوا۔ فائل، مقرر مقام اور منصوبے کی گنجائش دیکھیں۔ میعاد ختم ہونے پر دوبارہ جانچیں۔ تصدیق میں خلل آنے پر محفوظ نتیجہ جانچنے کے لیے وہی فائل دوبارہ آزمائیں۔')}</p>
            {previewMutation.isError&&file?<Button type="button" variant="outline" className="wx-staff-import-button" disabled={pending} onClick={()=>previewMutation.mutate(file)}>{t('Retry')}</Button>:null}
          </div>:null}
          {preview?<section className="wx-staff-import-step wx-staff-import-preview" aria-labelledby={`staff-preview-${location.id}`}>
            <h3 id={`staff-preview-${location.id}`}>{t('Preview')}</h3>
            <p role="status"><bdi>{number(preview.total)}</bdi> {say('Employees Found','ملازمین ملے')} · <bdi>{number(preview.valid)}</bdi> {say('Valid','درست')} · <bdi>{number(preview.total-preview.valid)}</bdi> {say('Errors','غلطیاں')}</p>
            <p>{t('{count} of {total} rows are ready to import.',{count:number(preview.valid),total:number(preview.total)})}</p>
            <DataTable data={preview.rows} rowKey={row=>row.row} pageSize={20} mobileCards columns={[
              {key:'row',header:say('Row','قطار'),render:row=>number(row.row)},
              {key:'name',header:say('Name','نام'),render:row=>(
                <div className="wx-staff-import-person">
                  <strong><bdi>{row.name}</bdi></strong>
                  <span>{say('Phone','فون')}: <bdi>{row.phone}</bdi></span>
                  <span>{row.email?.trim() ? <>{say('Email','ای میل')}: <bdi>{row.email}</bdi></> : say('No email','کوئی ای میل نہیں')}</span>
                </div>
              )},
              {key:'shift',header:say('Shift','شفٹ'),render:row=><bdi>{row.start}–{row.end}</bdi>},
              {key:'errors',header:t('Check'),render:row=><div className="wx-staff-import-row-status"><StatusPill tone={row.errors.length?'bad':'ok'}>{row.errors.length?'Check':'Ready'}</StatusPill>{row.errors.map(message=><p key={message}>{rowError(message)}</p>)}</div>},
            ]}/>
            {canConfirm?<p>{say('You are about to import','آپ درآمد کرنے والے ہیں:')} <bdi>{number(preview.total)}</bdi> {say('employees into','ملازمین، مقام:')} <bdi>{preview.location.name}</bdi>.</p>:<p className="wx-staff-import-correction">{say('Correct the errors and upload the spreadsheet again.','غلطیاں درست کرکے شیٹ دوبارہ اپ لوڈ کریں۔')}</p>}
          </section>:null}
        </>}
      </div>
    </SidePanel>
  </>;
}
