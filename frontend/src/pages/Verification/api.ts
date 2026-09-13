import { client } from '@/api/client';
import type { VerificationManifest, EvidenceAttempt } from './types';
export const getVerification = async (id:number):Promise<VerificationManifest> => {
 const data=(await client.get<{data:Omit<VerificationManifest,'items'> & {areaId:number;areaName:string;caseSummary?:{id:number;state:string};items:Array<Omit<VerificationManifest['items'][number],'requirements'>&{name:string;requirements:Array<VerificationManifest['items'][number]['requirements'][number]&{instructions:string}>}>}}>(`/task-instance/${id}/verification`)).data.data;
 return {...data,area:{id:data.areaId,name:data.areaName},exceptions:data.caseSummary?[data.caseSummary]:[],items:data.items.map(i=>({...i,nameSnapshot:i.name,requirements:i.requirements.map(r=>({...r,instructionsSnapshot:r.instructions}))}))};
};
export const getVerificationHistory = async (id: number, cursor?: string) => (await client.get<{data:{attempts:EvidenceAttempt[];nextCursor:string|null}}>(`/task-instance/${id}/verification/history`,{params:{cursor}})).data.data;
export const getEvidenceBlob = async (id: string, signal?: AbortSignal) => (await client.get<Blob>(`/evidence/${encodeURIComponent(id)}/content`, {params:{variant:'review'},responseType:'blob',signal})).data;
