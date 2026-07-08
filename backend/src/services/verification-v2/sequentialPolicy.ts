export const SEQUENTIAL_WORKFLOW='SEQUENTIAL_CLEF_V1';
export function sequentialCapture(value:unknown){return (value as {captureWorkflow?:string}|null)?.captureWorkflow===SEQUENTIAL_WORKFLOW;}
export const checkedAttempt=(state:string)=>['PASSED','REVIEW_REQUIRED','PRIVACY_HOLD','MANAGER_ACCEPTED','WAIVED','SERVICE_FAILURE'].includes(state);
export function objectCaptureDeadline(now:Date,sessionDeadline:Date,seconds:number,usedMilliseconds=0){
 if(!Number.isFinite(seconds)||seconds<15||seconds>600)throw new Error('Invalid object capture duration');
 return new Date(Math.min(+sessionDeadline,+now+Math.max(0,seconds*1000-usedMilliseconds)));
}
export function staffTaskPresentation<T extends {status:string;staffSubmittedAt?:Date|null;completionOutcome?:unknown;verificationState?:unknown}>(task:T){
 return {...task,...(task.staffSubmittedAt?{status:'COMPLETED'}:{}),completionOutcome:null,verificationState:task.staffSubmittedAt||task.status==='COMPLETED'?'COMPLETED':task.verificationState};
}

/** Cleaning submission and manager verification are separate dashboard states. */
export function operationalTaskStatus<T extends {status:string;staffSubmittedAt?:Date|null}>(task:T){
 return task.staffSubmittedAt&&['IN_PROGRESS','NOT_COMPLETED_INTIME'].includes(task.status)?'COMPLETED' as const:task.status;
}
export function managerTaskPresentation<T extends {status:string;staffSubmittedAt?:Date|null}>(task:T){
 return {...task,status:operationalTaskStatus(task)};
}

export function currentPhotoSlots<T extends {id:string;requirementId?:string|null;contextKey?:string|null;generation:number}>(slots:T[]):T[]{return slots.filter(slot=>!slots.some(other=>other.id!==slot.id&&other.generation>slot.generation&&(slot.requirementId?other.requirementId===slot.requirementId:other.contextKey===slot.contextKey)));}
