import { client } from '@/api/client';
import type { ExceptionAction, ExceptionDetail, ReviewClosureAction, PerformanceCategory } from './types';
export const getException = async (id: number, cursors: {eventCursor?:string;attemptCursor?:string;decisionCursor?:string} = {}) => (await client.get<{data:ExceptionDetail}>(`/verification-exceptions/${id}`,{params:cursors})).data.data;
export const readException = async (id: number) => (await client.post(`/verification-exceptions/${id}/read`)).data.data;
export const decideException = async (id: number, input: {requestId:string;expectedVersion:number;issueId?:number;requirementId?:string;action:ExceptionAction;reasonCode:string;note?:string;evidenceAttemptId?:string;extensionMinutes?:number;followUpTaskInstanceId?:number}) => (await client.post(`/verification-exceptions/${id}/actions`,input)).data.data;

export const closeException = async (id:number,input:{requestId:string;expectedVersion:number;action:ReviewClosureAction;note:string;staffId?:number;category?:PerformanceCategory}) => (await client.post(`/verification-exceptions/${id}/close`,input)).data.data;
