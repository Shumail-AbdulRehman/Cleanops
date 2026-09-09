import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import useAuth from '@/hooks/useAuth';
import { getCurrentUser } from '@/api/auth';
import { useLanguage } from '@/i18n/context';
import { ArrowUpRight, RefreshCw, TriangleAlert } from 'lucide-react';
import '@/workspace-tokens.css';
import './billing-account-v6.css';
import { getBillingLifecycle, navigateToBillingPortal, prepareBillingPortal } from '../api';
import { useBillingCatalog, useBillingLifecycle } from '../queries';
import { deriveBillingViewState } from './billingViewState';
import { formatBillingPrice } from './billingPrice';
import BillingSetupLayout from './BillingSetupLayout';

export default function BillingAccountPage() {
 const {user}=useAuth();const {t}=useLanguage();
 if(user?.role!=='ADMIN')return <BillingSetupLayout variant="settings"><h1>{t('Plan & billing')}</h1><p role="alert">{t('Only the company owner can view or change billing.')}</p><Link to="/login">{t('Sign in again')}</Link></BillingSetupLayout>;
 return <OwnerAccount key={`${user.companyId}:${user.id}`} companyId={user.companyId} ownerId={user.id}/>;
}
function OwnerAccount({companyId,ownerId}:{companyId:number;ownerId:number}) {
 const {t,language}=useLanguage();const query=useBillingLifecycle(),catalog=useBillingCatalog();const [opening,setOpening]=useState(false),[error,setError]=useState(false);
 const session=useRef<{active:boolean;busy:boolean;controller:AbortController}|null>(null);
 useLayoutEffect(()=>{const current={active:true,busy:false,controller:new AbortController()};session.current=current;return()=>{current.active=false;current.controller.abort();};},[]);
 const view=deriveBillingViewState({owner:{companyId,ownerId},dataOwner:query.dataOwner,data:query.data,read:query.isPending?'loading':query.isError?'error':query.isFetching?'stale':'fresh',httpStatus:(query.error as {response?:{status?:number}}|null)?.response?.status});
 const data=view.data,sub=data?.subscription;
 const matches=catalog.data?.filter(row=>sub?.priceId===row.priceId&&sub?.interval===row.interval&&sub?.plan===row.plan)??[];
 const entry=matches.length===1&&!catalog.isError&&!catalog.isFetching?matches[0]:null;
 const price=entry?formatBillingPrice(entry.amount,entry.currencyCode,entry.interval,language==='ur'?'ur-PK':'en-PK'):null;
 const date=(value:string|null|undefined)=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat(language==='ur'?'ur-PK':'en-PK',{dateStyle:'medium',timeZone:'UTC'}).format(new Date(value)):t('Not available');
 const openPortal=async()=>{
  const current=session.current;if(!current?.active||current.busy||!view.canOpenPortal||query.isFetching)return;
  current.busy=true;setOpening(true);setError(false);
  const verify=async()=>{const actor=await getCurrentUser();if(!current.active||actor?.role!=='ADMIN'||actor.companyId!==companyId||actor.id!==ownerId)throw new Error('Account changed');};
  try{
   await verify();const facts=await getBillingLifecycle(current.controller.signal,companyId);
   if(!current.active||!facts.portalAvailable)throw new Error('Unavailable');
   await verify();const portal=await prepareBillingPortal(current.controller.signal);await verify();
   if(current.active)navigateToBillingPortal(portal.url);
  }catch{if(current.active)setError(true);}finally{current.busy=false;if(current.active)setOpening(false);}
 };
 const statuses:Record<string,string>={active:'Active',trialing:'Trialing',past_due:'Past due',paused:'Paused',canceled:'Canceled'};
 const facts:[string,ReactNode][]=[[t('Provider subscription status'),t(sub?statuses[sub.status]??'Unknown':'No linked subscription record')],[t('Recurring price'),price?<><bdi dir="ltr">{price.formatted}</bdi> · {t(entry?.interval==='year'?'Yearly':'Monthly')}</>:t('Provider price unavailable')],[t('Next billing date'),sub?.scheduledChangeAction?t('Not available'):['active','trialing'].includes(sub?.status??'')?date(sub?.periodEnd):t('Not available')],[t('Scheduled change'),sub?.scheduledChangeAction?<>{sub.scheduledChangeAction} · <bdi>{date(sub.scheduledChangeAt)}</bdi></>:t('No scheduled change recorded')]];
 const plan=data?t((sub?.plan??data.company.plan)==='ADVANCED'?'Enterprise':sub?.plan??data.company.plan):'';
 return <BillingSetupLayout variant="settings"><div className="workspace wx-billing">
  <header className="wx-billing-header"><div><h1>{t('Plan & billing')}</h1><p>{t('Your subscription and how much of it you’re using.')}</p></div><button type="button" className="wx-billing-button" disabled={query.isFetching} onClick={()=>void query.refreshBilling()}><RefreshCw size={16} aria-hidden="true"/>{t('Refresh status')}</button></header>
  {!data?<p className="wx-billing-panel wx-billing-notice" role={query.isError?'alert':'status'}>{t(query.isPending?'Checking subscription status…':'Billing is temporarily unavailable. Refresh status to try again.')}</p>:<>
   {view.kind==='restricted'?<p className="wx-billing-panel wx-billing-notice wx-billing-notice--warn" role="status">{t('Company operations are restricted. Billing and account security remain available.')}</p>:null}
   <div className="wx-billing-grid">
    <section className="wx-billing-panel wx-billing-plan" aria-labelledby="current-subscription">
     <small>{t('Current plan')}</small><h2 id="current-subscription"><bdi>{plan}</bdi></h2>
     <dl className="wx-billing-facts">{facts.map(([label,value],i)=><div key={i}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
     <p className="wx-billing-muted">{t('Your existing subscription is managed in Paddle.')}</p>
     <button type="button" className="wx-billing-button" disabled={!view.canOpenPortal||query.isFetching||opening} onClick={()=>void openPortal()}>{t(opening?'Opening billing portal…':'Manage in Paddle')}{opening?null:<ArrowUpRight size={16} aria-hidden="true" className="wx-billing-flip"/>}</button>
     {error?<p className="wx-billing-error" role="alert">{t('Billing portal unavailable. Refresh status to try again.')}</p>:null}
    </section>
    <section className="wx-billing-panel wx-billing-usage" aria-labelledby="usage-heading"><h2 id="usage-heading">{t('Workspace usage')}</h2>
     {(['locations','staff','managers'] as const).map(resource=>{const used=data.usage[resource],limit=data.limits[resource],over=used>limit;return <div key={resource} className={`wx-billing-meter${over?' wx-billing-meter--over':''}`}>
      <div><b>{t({locations:'Locations',staff:'Staff seats',managers:'Manager seats'}[resource])}</b><bdi dir="ltr">{used} / {limit}</bdi></div>
      <span className="wx-billing-bar" aria-hidden="true"><span style={{inlineSize:`${Math.min(100,used/Math.max(1,limit)*100)}%`}}/></span>
      {over?<span className="wx-billing-over"><TriangleAlert size={14} aria-hidden="true"/>{t('Over limit')}</span>:null}
     </div>;})}
     <p className="wx-billing-muted">{t('The company owner uses one manager seat.')}</p><p className="wx-billing-muted">{t('Existing records and history are preserved when a limit is exceeded. New capacity is checked by the server.')}</p>
    </section>
   </div>
  </>}
 </div></BillingSetupLayout>;
}
