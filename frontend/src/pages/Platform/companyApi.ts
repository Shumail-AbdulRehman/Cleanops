import { operatorRequest } from './operatorSession';
export type CompanySummary={id:number;name:string;plan:string;isActive:boolean;operationalStatus:'ACTIVE'|'SUSPENDED';accountVersion:number;createdAt:string;updatedAt:string;counts:{managers:number;staff:number;locations:number}};
export type CompanyDetail={company:CompanySummary&{suspendedAt:string|null;suspensionReason:string|null};operationalReadAllowed:boolean;billingConfigured:boolean;mirroredSubscriptionStatus:string;providerState:string;subscription:null|{status:string;plan:string|null;catalogQualified:boolean;periodStart:string|null;periodEnd:string|null;canceledAt:string|null;pausedAt:string|null;scheduledChangeAction:string|null;scheduledChangeAt:string|null;lastEventAt:string;mirroredAt:string};activity:Array<{id:number;action:string;reason:string|null;createdAt:string}>};
export type CompanyFilters={q?:string;status?:string;after?:string};
export async function getCompanies(filters:CompanyFilters,signal?:AbortSignal){
 const params=new URLSearchParams({limit:'25',...Object.fromEntries(Object.entries(filters).filter(([,v])=>!!v))});
 return (await operatorRequest<{data:{items:CompanySummary[];nextCursor:string|null}}>(`/platform/companies?${params}`,{signal})).data;
}
export async function getCompany(id:number,signal?:AbortSignal){return (await operatorRequest<{data:CompanyDetail}>(`/platform/companies/${id}`,{signal})).data;}
export async function setCompanyStatus(id:number,body:{operationalStatus:'ACTIVE'|'SUSPENDED';expectedVersion:number;reason:string}){return (await operatorRequest<{data:{company:CompanySummary;changed:boolean}}>(`/platform/companies/${id}/status`,{method:'PATCH',body})).data;}
