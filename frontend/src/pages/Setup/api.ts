import { client } from '@/api/client';
import type { ApiEnvelope } from '../Subscription/types';
export type SetupSite = {
 id:number;name:string;timezone:string;setupReady:boolean;reasons:string[];
 counts:{staffWithShift:number;activeAreas:number;readySchedules:number;tasksToday:number;unassignedTasksToday:number};
};
export type SetupReadiness = {
 asOf:string;totalLocations:number;sites:SetupSite[];nextCursor:number|null;
 calendar:'DAILY_INCLUDES_EVERY_DAY';access:{manageWork:boolean};
};
export async function getSetupReadiness(afterId=0,signal?:AbortSignal) {
 return (await client.get<ApiEnvelope<SetupReadiness>>('/location/readiness',{params:{afterId,limit:20},signal})).data.data;
}
