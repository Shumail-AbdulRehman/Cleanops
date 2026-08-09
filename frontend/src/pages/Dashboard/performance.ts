import { useQuery } from '@tanstack/react-query';
import { useSelector } from 'react-redux';
import { client } from '@/api/client';
import type { RootState } from '@/store/store';
import type { OperationsBase, LocationScope } from '../Manager/operations';

export type PerformanceCounts = {
  scheduledShifts:number;present:number;late:number;missing:number;tasks:number;submitted:number;
  verified:number;accepted:number;inProgress:number;overdue:number;notStarted:number;reviews:number;
  attendanceRate:number|null;submissionRate:number|null;
};
export type SitePerformance = PerformanceCounts & {location:LocationScope;staff:number;today:Omit<PerformanceCounts,'attendanceRate'|'submissionRate'> & {status:'ATTENTION'|'IN_PROGRESS'|'ON_TRACK'|'NO_ACTIVITY'}};
export type CompanyPerformance = OperationsBase & {
  period:number;dateFrom:string|null;dateTo:string|null;
  summary:PerformanceCounts & {previous:PerformanceCounts;attendanceChange:number|null;submissionChange:number|null;totalLocations:number;activeLocations:number;totalStaff:number};
  series:(PerformanceCounts & {date:string|null;offset:number})[];
  sites:SitePerformance[];
};
export function useCompanyPerformance(filters:Record<string,string>){
  const scope=useSelector((s:RootState)=>`${s.auth.user?.companyId}:${s.auth.user?.role}:${s.auth.user?.id}`);
  return useQuery({
    queryKey:['operations',scope,'performance',filters],
    queryFn:async({signal})=>(await client.get<{data:CompanyPerformance}>('/manager/operations/performance',{params:filters,signal})).data.data,
    staleTime:30000,gcTime:120000,refetchInterval:60000,refetchIntervalInBackground:false,refetchOnWindowFocus:true,refetchOnReconnect:true,
  });
}
export const statusLabel = {ATTENTION:'Needs attention',IN_PROGRESS:'Work in progress',ON_TRACK:'On schedule',NO_ACTIVITY:'No activity'};
