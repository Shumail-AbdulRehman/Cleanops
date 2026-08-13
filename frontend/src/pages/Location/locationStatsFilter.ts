import { formatInTimeZone } from 'date-fns-tz';
import type { LocationStatsFilter } from './queries';
export type LocationHistoryPeriod = 'today'|'yesterday'|'7days'|'all';

export function locationStatsFilter(period:LocationHistoryPeriod,timezone:string|undefined,now=new Date()):LocationStatsFilter|undefined {
 if(period==='all')return undefined;
 if(period==='7days')return {type:'days',days:7};
 if(!timezone)return undefined;
 const localDate=formatInTimeZone(now,timezone,'yyyy-MM-dd');
 // Move the calendar date rather than subtracting 24 hours from a local clock.
 // A DST transition can make the previous local day 23 or 25 hours long.
 const date=new Date(localDate+'T12:00:00Z');
 if(period==='yesterday')date.setUTCDate(date.getUTCDate()-1);
 const value=date.toISOString().slice(0,10);
 return {type:'range',dateFrom:value,dateTo:value};
}
