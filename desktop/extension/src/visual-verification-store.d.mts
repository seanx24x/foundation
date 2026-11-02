import type {RuntimeCaptureSnapshot,CaptureConditions,CaptureImage} from './runtime-capture-store.mjs';
import type {ReplaySnapshot,ReplayRecord,ReplayRequested} from './runtime-replay-store.mjs';
import type {RuntimeWorkspaceSnapshot,RuntimeRun} from './runtime-workspace-store.mjs';
export interface VerificationBasis {proposalId:string;title:string;path:string;beforeHash:string;afterHash:string;baseRevision:string;appliedRevision:string;impactDigest:string}
export interface VerificationScope {featureId:string;featureTitle:string;screenId:string;screenTitle:string;scenarioId:string;scenarioTitle:string}
export interface EvidenceReference {runId:string;digest:string;capture:{id:string;digest:string}|null;replay:{id:string;digest:string}|null}
export interface PreparedVisualVerification {basis:VerificationBasis;scope:VerificationScope;before:EvidenceReference;after:EvidenceReference}
export interface VisualVerificationEntry extends PreparedVisualVerification {id:string;createdAt:string}
export interface VisualVerificationManifest {schemaVersion:1;projectId:string;revision:number;entries:VisualVerificationEntry[]}
export interface VisualVerificationSnapshot extends VisualVerificationManifest {storage:{status:'saved'|'saving'|'error'|'unavailable';message?:string}}
export interface VisualVerificationStore {snapshot():VisualVerificationSnapshot;link(input:PreparedVisualVerification,expectedRevision:number,options?:{isCurrent?:()=>boolean}):Promise<VisualVerificationEntry>;retry():Promise<VisualVerificationSnapshot>;dispose():Promise<void>}
export interface VerificationInputs {projectId:string;proposal?:unknown;workspace:RuntimeWorkspaceSnapshot;captures:RuntimeCaptureSnapshot;replays:ReplaySnapshot}
export const VISUAL_VERIFICATION_LIMITS:Readonly<{records:40;perProposal:8;manifestBytes:number}>;
export function prepareVisualVerificationLink(input:VerificationInputs & {scenarioId:string;beforeId:string;afterId:string}):PreparedVisualVerification;
export function visualVerificationView(input:VerificationInputs & {verification:VisualVerificationSnapshot;currentSources?:{path:string;revision:string}[];dirtyPaths?:string[]}):VisualVerificationView;
export function visualVerificationDigest(value:unknown):string;
export function createVisualVerificationStore(options:{projectId:string;read:()=>unknown;write:(value:VisualVerificationManifest)=>PromiseLike<unknown>|unknown;onChange?:()=>void}):VisualVerificationStore;

export interface VerificationChoice {id:string;label:string;eligible:boolean;reason:string;status:RuntimeRun['status'];assessment:RuntimeRun['assessment'];endedAt?:string;capture:boolean;replay:boolean}
export interface VerificationScenario extends VerificationScope {canView:boolean;reason:string;beforeChoices:VerificationChoice[];afterChoices:VerificationChoice[]}
export interface VerificationProposalView {proposalId:string|null;proposalBasis:string|null;canLink:boolean;reason:string;scenarios:VerificationScenario[]}
export interface VerificationSideSummary {
 runId:string;status:RuntimeRun['status'];assessment:RuntimeRun['assessment'];note:string;startedAt:string;endedAt?:string;
 capture:{id:string;conditions:CaptureConditions;image:CaptureImage}|null;
 replay:{id:string;status:ReplayRecord['status'];reason?:ReplayRecord['reason'];requested:ReplayRequested}|null;
 sourceHash:string|null;dirtyPaths:string[];
}
export interface VerificationRecordView extends VerificationScope {
 id:string;proposalId:string;title:string;path:string;beforeId:string;afterId:string;createdAt:string;
 currentRelevance:'applied-current'|'source-changed'|'historical'|'unknown';canCompare:boolean;reason:string;warnings:string[];
 before:VerificationSideSummary|null;after:VerificationSideSummary|null;
 compilation:'not-recorded';visual:'not-assessed';sourceRelationship:'unverified';
}
export interface VisualVerificationView {schemaVersion:1;projectId:string;revision:number;storage:VisualVerificationSnapshot['storage'];proposal:VerificationProposalView;records:VerificationRecordView[]}
