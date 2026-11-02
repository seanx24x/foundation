import type {CaptureBinding,CaptureContext} from './runtime-capture-store.mjs';
export type ReplayReason='cancelled'|'timeout'|'runtime-changed'|'recipe-changed'|'step-failed'|'storage-failed'|'host-restarted'|'host-disposed'|'source-changed'|'context-changed'|'transport-failed'|'preview-changed';
export interface ReplayRecipe {id:string;title:string;route:string;fixture:{id:string;label:string};registrationId:string;catalogDigest:string;steps:{id:string;title:string}[]}
export interface ReplayRequested {theme:'light'|'dark';motion:'system'|'reduce';viewportWidthCss:390|768|960;viewportHeightCss:680}
export interface ReplayObserved {viewportWidthCss:number;viewportHeightCss:number;deviceScaleFactor:number;colorSchemePreference:'light'|'dark';reducedMotionPreference:'reduce'|'no-preference'}
export interface ReplayUnit {id:string;status:'pending'|'running'|'completed'|'failed'|'cancelled'|'interrupted';effects:'not-started'|'unknown';startedAt?:string;endedAt?:string}
export interface ReplayRecord {id:string;executionId:string;runId:string;featureId:string;screenId:string;scenarioId:string;binding:CaptureBinding;recipe:ReplayRecipe;requested:ReplayRequested;startedAt:string;endedAt?:string;status:'running'|'completed'|'failed'|'cancelled'|'interrupted';prepare:ReplayUnit;steps:ReplayUnit[];observed:ReplayObserved|null;reason?:ReplayReason;sourceRelationship:'unverified'}
export interface ReplayManifest {schemaVersion:1;projectId:string;revision:number;replays:ReplayRecord[]}
export interface ReplaySnapshot extends ReplayManifest {storage:{status:'saved'|'saving'|'error'|'unavailable';message?:string}}
export interface ReplayBegin {context:CaptureContext;executionId:string;recipe:ReplayRecipe;requested:ReplayRequested}
export type ReplayProgress=({phase:'prepare';stepId?:never}|{phase:'step';stepId:string})&({status:'running';observed?:never}|{status:'completed';observed?:ReplayObserved});
export type ReplayResult={status:'completed';reason?:never}|{status:'failed'|'cancelled'|'interrupted';reason?:ReplayReason};
export interface RuntimeReplayStore {
 snapshot():ReplaySnapshot;
 /** Constant-time ownership state without copying replay history. */
 state():{revision:number;storageStatus:ReplaySnapshot['storage']['status']};
 begin(input:ReplayBegin,expectedRevision:number):Promise<ReplayRecord>;
 /** Persist running before dispatch; persist completed before the next application action. */
 update(id:string,progress:ReplayProgress):Promise<ReplayRecord>;
 finish(id:string,result:ReplayResult):Promise<ReplayRecord>;
 /** Durability recovery only. Never repeats or resumes application actions. */
 retry():Promise<ReplaySnapshot>;
 dispose():Promise<void>;
}
export const REPLAY_LIMITS:Readonly<{records:40;steps:12;sources:32;manifestBytes:number}>;
export const REPLAY_REASONS:readonly ReplayReason[];
export function createRuntimeReplayStore(options:{projectId:string;read:()=>unknown;write:(value:ReplayManifest)=>PromiseLike<unknown>|unknown;onChange?:()=>void}):RuntimeReplayStore;
