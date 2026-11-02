import type {SourceInvestigationSnapshot} from './source-investigation.mjs';
export type InvestigationTarget={id:string;path:string;revision:string;evidenceIds:string[]};
export type InvestigationContext={version:1;conversationId:string;rootRequestId:string;parentRequestId:string;result:SourceInvestigationSnapshot;goal:string;previousExplanation:{requestId:string;kind:'answer'|'decision';text:string};targets:InvestigationTarget[];budget:{modelStep:number;modelLimit:3;toolsUsed:number;toolLimit:2};digest:string};
export type InvestigationContextDescriptor={version:1;conversationId:string;rootRequestId:string;parentRequestId:string;digest:string};
export type InvestigationDecision={schemaVersion:1;id:string;projectId:string;verificationStatus:'not-run';title:string;summary:string;decision:{kind:'investigate';target:InvestigationTarget;reason:string}|{kind:'finish';conclusion:string};limitations:string[]};
export type InvestigationAttempt={id:string;status:'running'|'complete'|'failed'|'stopped'|'interrupted';startedAt:string;finishedAt?:string;result?:SourceInvestigationSnapshot;reason?:string};
export type InvestigationChain={rootRequestId:string;latestRequestId:string;modelUsed:number;toolUsed:number;ended:boolean;reason?:string;canContinue:boolean;canRun:boolean;canRetryTool:boolean;canEnd:boolean};
export class InvestigationContinuationError extends Error{status:number;code:string;}
export function deriveInvestigationContext(conversation:any,parentRequestId:string):InvestigationContext;
export function deriveInvestigationChain(conversation:any,rootRequestId:string):InvestigationChain;
export function validateInvestigationContext(value:unknown,projectId?:string,files?:Array<{path:string;revision:string;source:string}>):InvestigationContext;
export function investigationContextDescriptor(value:unknown):InvestigationContextDescriptor;
export function normalizeInvestigationContextDescriptor(value:unknown):InvestigationContextDescriptor|undefined;
export function investigationContextForProvider(value:unknown):any;
export function createInvestigationDecision(input:{raw:string;context:InvestigationContext;projectId:string}):InvestigationDecision;
export function validateInvestigationDecision(value:unknown,context:InvestigationContext,projectId:string):InvestigationDecision;
