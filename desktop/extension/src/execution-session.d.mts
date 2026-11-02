export type ExecutionPlanBinding = {planId:string;stepId:string;attemptId:string};
export type ExecutionStatus = 'preparing'|'ready'|'running'|'passed'|'failed'|'cancelled'|'interrupted'|'unavailable';
export type ExecutionTask = {id:'node:test'|'typescript:check';label:string;command:string};
export type ExecutionRecord = {plan?:ExecutionPlanBinding;id:string;projectId:string;groupId:string;groupRevision:number;groupDigest:string;revision:number;status:ExecutionStatus;createdAt:string;updatedAt:string;files?:number;bytes?:number;snapshotRevision?:string;tasks:ExecutionTask[];taskId?:string;startedAt?:string;finishedAt?:string;exitCode?:number|null;signal?:string|null;output:string;outputTruncated:boolean;reason?:string};
export type ExecutionSnapshot = {current:ExecutionRecord|null;history:ExecutionRecord[];busy:boolean;storage:{status:'saved'|'saving'|'error'|'unavailable';message?:string};capabilities:{supported:boolean;reason?:string;network:'blocked'|'unavailable';filesystem:'isolated-copy'};assessment:{canPrepare:boolean;canRun:boolean;canStop:boolean;reason?:string};error?:string};
export function changeGroupDigest(group:unknown):string;
export function createExecutionSession(options:{storageRoot:string;projectId:string;root:string;nodePath?:string;isCurrent?:()=>boolean;onChange?:(snapshot:ExecutionSnapshot)=>void}):{
 isBusy():boolean;
 snapshot():ExecutionSnapshot;
 load():Promise<ExecutionSnapshot>;
 prepare(group:unknown,options?:{guard?:()=>Promise<void>;plan?:ExecutionPlanBinding}):Promise<ExecutionSnapshot>;
 run(id:string,expectedRevision:number,taskId:string,options?:{guard?:()=>Promise<void>;beforeRun?:()=>void}):Promise<ExecutionSnapshot>;
 stop(id?:string,expectedRevision?:number):Promise<ExecutionSnapshot>;
 retry():Promise<ExecutionSnapshot>;
 dispose():Promise<void>;
};
