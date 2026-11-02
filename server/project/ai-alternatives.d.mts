import type {ChangeSet} from '../../desktop/extension/src/change-set-session.mjs';
import type {AlternativeScope} from '../../desktop/extension/src/visual-alternatives-session.mjs';
export interface AlternativeGeneration {version:1;count:2;scope:AlternativeScope}
export interface AIAlternativeCandidate {id:string;name:string;reason:string;changeSet:ChangeSet}
export interface AIAlternatives {schemaVersion:1;id:string;projectId:string;title:string;summary:string;generation:AlternativeGeneration;context:{path:string;revision:string;hash:string}[];candidates:AIAlternativeCandidate[];verificationStatus:'not-run'}
export const AI_ALTERNATIVE_LIMITS:Readonly<{candidates:2;files:8;sourceBytes:number;rawBytes:number;nameBytes:80;reasonBytes:2000}>;
export class AIAlternativesError extends Error {status:number;code:string;constructor(code?:string,message?:string)}
export function normalizeAlternativeGeneration(input:unknown):AlternativeGeneration|undefined;
export function validateAlternativeGenerationFiles(input:unknown,files:{path:string;revision:string;source:string}[]):AlternativeGeneration;
export function normalizeAIAlternatives(input:unknown,projectId?:string,files?:{path:string;revision:string;source:string}[]):AIAlternatives;
export function aiAlternativesDigest(input:unknown):string;
export function createAIAlternatives(input:{raw:string;files:{path:string;revision:string;source:string}[];projectId:string;generation:AlternativeGeneration}):AIAlternatives;
