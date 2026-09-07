import {Link} from 'react-router-dom';
import {useLanguage} from '@/i18n/context';
import SurfaceCard from '@/components/common/SurfaceCard';
import {performanceCategoryLabels} from '../Exceptions/performancePresentation';
import type {PerformanceCategory} from '../Exceptions/types';
type Reports={total:number;reports:Array<{id:number;reviewId:number;recordedAt:string;category:string;note:string;taskId:number;taskTitle:string;managerName:string}>};
export default function StaffPerformanceIssues({data,periodLabel,staffId}:{data?:Reports;periodLabel:string;staffId:number}){
 const {t,language}=useLanguage();
 const total=data?.total??0;
 return <SurfaceCard title={t('Staff performance issues')} description={t('Manager-recorded issues for {period}.',{period:t(periodLabel)})} className="lg:col-span-2">
  <p className="ops-performance-total"><strong>{total}</strong> {t('recorded performance issues')}</p>
  {data?.reports?.length?<ul className="ops-performance-reports">{data.reports.map(report=><li key={report.id}>
   <div className="flex flex-wrap items-center justify-between gap-2"><strong>{t(performanceCategoryLabels[report.category as PerformanceCategory]??'Other performance concern')}</strong><time dateTime={report.recordedAt}>{new Date(report.recordedAt).toLocaleDateString(language==='ur'?'ur-PK':'en-PK')}</time></div>
   <p>{report.note}</p>
   <div className="flex flex-wrap gap-3 text-sm text-muted-foreground"><Link to={`/exceptions/${report.reviewId}?returnTo=${encodeURIComponent('/staff/'+staffId)}`}>{report.taskTitle}</Link><span>{t('Recorded by {name}',{name:report.managerName})}</span></div>
  </li>)}</ul>:<p className="text-sm text-muted-foreground">{t('No manager-recorded performance issues in this period.')}</p>}
  {total>(data?.reports.length??0)&&<p className="mt-3 text-sm text-muted-foreground">{t('Showing the latest {count} issues.',{count:data?.reports.length??0})}</p>}
 </SurfaceCard>;
}
