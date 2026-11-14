export function verificationTaskLabel(task:{status:string;verificationState?:string;completionOutcome?:string|null},action=false):string {
 if(task.status==='COMPLETED'||task.completionOutcome)return 'Task completed';
 return task.status==='PENDING'?'Start cleaning':action?'Continue task':task.verificationState==='PROCESSING'?'Checking photos':'In progress';
}
