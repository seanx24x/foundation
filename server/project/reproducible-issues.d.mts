import type {RuntimeRun} from '../../desktop/extension/src/runtime-workspace-store.mjs';
import type {RuntimeCapture} from '../../desktop/extension/src/runtime-capture-store.mjs';
import type {ReplayRecord} from '../../desktop/extension/src/runtime-replay-store.mjs';
export type IssueRun=Omit<RuntimeRun,'status'|'endedAt'>&{status:'completed'|'cancelled'|'interrupted';endedAt:string};
export type IssueReplay=Omit<ReplayRecord,'status'|'endedAt'>&{status:'completed'|'failed'|'cancelled'|'interrupted';endedAt:string};
export interface ReproducibleIssue {id:string;projectId:string;createdAt:string;title:string;actualOutcome:string;reproduction:{steps:string[];expectedOutcome:string;origin:'scenario'};run:IssueRun;runDigest:string;contextFiles:{path:string;hash:string}[];replay:{replay:IssueReplay;digest:string}|null;capture:{capture:RuntimeCapture;digest:string}|null;sourceRelationship:'unverified';compilation:'not-recorded'}
export type ReproducibleIssueInput=Omit<ReproducibleIssue,'id'|'createdAt'>;
export type IssueSourceStatus='current'|'stale'|'missing';
export type IssueEvidenceStatus='available'|'changed'|'missing';
export interface ReproducibleIssueAssessment {source:IssueSourceStatus;captureSource:IssueSourceStatus;run:IssueEvidenceStatus;replay:IssueEvidenceStatus|'not-attached';capture:IssueEvidenceStatus|'not-attached'}
export interface ReproducibleIssueContext {version:1;projectId:string;issues:{issue:ReproducibleIssue;digest:string;assessment:ReproducibleIssueAssessment}[]}
export interface ReproducibleIssueAssessmentInput {files:{path:string;hash:string|null}[];dirtyPaths?:string[];runDigest?:string|null;replayDigest?:string|null;captureDigest?:string|null}
export const REPRODUCIBLE_ISSUE_LIMITS:Readonly<{records:32;journalBytes:number;recordBytes:number;contextRecords:1;contextBytes:number}>;
export function normalizeReproducibleIssue(value:unknown,options?:{projectId?:string}):ReproducibleIssue;
export function reproducibleIssueDigest(value:unknown):string;
/** Metadata fingerprint only. Callers separately resolve trusted local provenance. */
export function reproducibleIssueEvidenceDigest(value:unknown):string;
export function normalizeReproducibleIssueContext(value:undefined,options?:{projectId?:string}):undefined;
export function normalizeReproducibleIssueContext(value:unknown,options?:{projectId?:string}):ReproducibleIssueContext|undefined;
export function assessReproducibleIssue(issue:ReproducibleIssue,current:ReproducibleIssueAssessmentInput):ReproducibleIssueAssessment;
