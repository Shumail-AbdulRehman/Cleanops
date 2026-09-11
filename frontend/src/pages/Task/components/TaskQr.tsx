import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSelector } from 'react-redux';
import { QRCodeSVG } from 'qrcode.react';
import { QrCode, Printer } from 'lucide-react';
import { client } from '@/api/client';
import type { RootState } from '@/store/store';
import { useLanguage } from '@/i18n/context';
import { Button } from '@/components/ui/button';
import { apiMessage } from '@/pages/Area/api';
type TaskQrData = {taskId:number;title:string;areaName:string;shiftStart:string;shiftEnd:string;timezone:string;payload:string};
export default function TaskQr({taskId, initialOpen = false}: {taskId:number;initialOpen?:boolean}) {
  const [open, setOpen] = useState(initialOpen);
  const {t, language} = useLanguage();
  const scope = useSelector((state:RootState) => `${state.auth.user?.companyId}:${state.auth.user?.role}:${state.auth.user?.id}`);
  const query = useQuery({queryKey:['task-qr',scope,taskId],queryFn:async({signal}) => (await client.get<{data:TaskQrData}>(`/task-instance/${taskId}/qr`,{signal})).data.data,enabled:open,staleTime:0,gcTime:0,retry:false});
  const data = query.data;
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {if(open && data){panel.current?.scrollIntoView({block:'nearest'});panel.current?.focus({preventScroll:true});}}, [open,data]);
  const time = (value:string) => new Intl.DateTimeFormat(language === 'ur' ? 'ur-PK' : 'en-PK', {timeZone:data?.timezone ?? 'UTC',dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
  return <div className="space-y-3">
    <Button variant="outline" aria-expanded={open} onClick={() => setOpen(!open)}><QrCode size={16} />{t(open ? 'Hide task QR' : 'Task QR')}</Button>
    {open && <section ref={panel} tabIndex={-1} className="task-qr-print space-y-4 border border-border rounded-lg p-5" aria-label={t('Task QR')}>
      {query.isPending ? <p role="status">{t('Loading task QR…')}</p> : query.isError ? <div role="alert"><p>{apiMessage(query.error)}</p><Button variant="outline" onClick={() => void query.refetch()}>{t('Retry')}</Button></div> : data && <>
        <div><h3 className="font-semibold">{data.title}</h3><p>{data.areaName}</p><p className="text-sm text-muted-foreground">{t('Task')} #{data.taskId}</p><p className="text-sm">{time(data.shiftStart)} – {time(data.shiftEnd)} ({data.timezone})</p></div>
        <QRCodeSVG value={data.payload} size={220} marginSize={4} aria-label={t('QR for task {id}',{id:data.taskId})} style={{maxWidth:'100%',height:'auto'}} />
        <p className="max-w-prose text-sm text-muted-foreground">{t('Generated automatically for this task only. Staff scan this code to start and again to take photos.')}</p>
        <Button variant="outline" onClick={() => window.print()}><Printer size={16} />{t('Print task QR')}</Button>
      </>}
    </section>}
  </div>;
}
