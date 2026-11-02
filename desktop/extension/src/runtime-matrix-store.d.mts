import type {CaptureSource} from './runtime-capture-store.mjs';
import type {ReplayRecipe,ReplayRequested,ReplayReason} from './runtime-replay-store.mjs';
import type {StateSuiteState} from './runtime-state-suite-store.mjs';
import type {RuntimeRun,RuntimeScreen,RuntimeScenario} from './runtime-workspace-store.mjs';
export type MatrixReason=ReplayReason|'capture-failed'|'observation-failed'|'capacity';
export type MatrixTerminal='completed'|'failed'|'cancelled'|'interrupted';
export interface MatrixSuite {id:string;title:string;revision:number;states:{state:StateSuiteState;recipe:ReplayRecipe}[]}
export interface MatrixBasis {feature:RuntimeRun['feature'];screen:RuntimeScreen;scenario:RuntimeScenario;definitionRevision:number;sources:CaptureSource[];dirtyPaths:string[];recipe:ReplayRecipe;suite?:MatrixSuite}
/** Reserved IDs exist before any application action; observationLinked confirms durable child creation. */
export interface MatrixCell {id:string;runId:string;replayExecutionId:string;requested:ReplayRequested;state?:StateSuiteState;status:'not-run'|'running'|MatrixTerminal;observationLinked:boolean;startedAt?:string;endedAt?:string;replayId?:string;captureId?:string;reason?:MatrixReason}
/** Lifecycle completion is not a behavioral assessment or visual verdict. Read outcomes from linked evidence. */
export interface MatrixRecord {id:string;executionId:string;basis:MatrixBasis;captureEach:boolean;startedAt:string;endedAt?:string;status:'running'|MatrixTerminal;reason?:MatrixReason;cells:MatrixCell[];sourceRelationship:'unverified'}
export interface MatrixManifest {schemaVersion:2;projectId:string;revision:number;matrices:MatrixRecord[]}
export interface MatrixSnapshot extends MatrixManifest {storage:{status:'saved'|'saving'|'error'|'unavailable';message?:string}}
export interface MatrixBegin {basis:MatrixBasis;cells:ReplayRequested[]|{state:StateSuiteState;requested:ReplayRequested}[];captureEach:boolean}
export interface MatrixEvidence {runId?:string;replayId?:string;captureId?:string}
export type MatrixResult={status:'completed';reason?:never}|{status:'failed'|'cancelled'|'interrupted';reason:MatrixReason};
export interface RuntimeMatrixStore {
 snapshot():MatrixSnapshot;
 begin(input:MatrixBegin,expectedRevision:number):Promise<MatrixRecord>;
 /** Write ahead before opening a fresh document or creating the reserved observation. */
 beginCell(id:string,cellId:string):Promise<MatrixRecord>;
 /** IDs are monotonic; links must be acquired in observation, replay, then optional capture order. */
 linkEvidence(id:string,cellId:string,evidence:MatrixEvidence):Promise<MatrixRecord>;
 /** Host-verified child links only on terminal cells in terminal matrices; no execution or lifecycle edits. */
 recoverEvidence(id:string,cellId:string,evidence:MatrixEvidence):Promise<MatrixRecord>;
 finishCell(id:string,cellId:string,result:MatrixResult):Promise<MatrixRecord>;
 finishMatrix(id:string,result:MatrixResult):Promise<MatrixRecord>;
 /** Persistence and sealing only. A running matrix is interrupted; application work never resumes. */
 retry():Promise<MatrixSnapshot>;
 dispose():Promise<void>;
}
export const MATRIX_LIMITS:Readonly<{records:40;cells:12;sources:32;steps:12;manifestBytes:number}>;
export const MATRIX_REASONS:readonly MatrixReason[];
export function createRuntimeMatrixStore(options:{projectId:string;read:()=>unknown;write:(value:MatrixManifest)=>PromiseLike<unknown>|unknown;onChange?:()=>void}):RuntimeMatrixStore;
