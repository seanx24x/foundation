import type {ChildProcess} from 'node:child_process';
export interface AlternativeVariant {id:'baseline'|'alternative';root:string;manifestDigest:string;files:number;bytes:number}
export interface PreparedAlternativeWorkspaces {comparisonId:string;path:string;beforeHash:string;afterHash:string;baselineDigest:string;variants:AlternativeVariant[]}
export interface OriginalWriteTemporary {path:string;dev:number;ino:number;hash:string}
export interface RetainedAlternativePair {path:string;before:string;after:string;beforeHash:string;afterHash:string;baselineDigest:string;manifestDigests:{baseline:string;alternative:string}}
export interface AlternativeGroupFileIdentity {path:string;beforeHash:string;afterHash:string}
export interface OriginalBatchTemporary extends OriginalWriteTemporary {targetPath:string}
export interface OriginalBatchWrite {phase:'preflight'|'before-write'|'complete';targetPath?:string;writtenPaths:string[];temporaries:OriginalBatchTemporary[]}
export interface PreparedAlternativeGroupWorkspaces {comparisonId:string;files:AlternativeGroupFileIdentity[];baselineDigest:string;variants:AlternativeVariant[]}
export interface RetainedAlternativeGroup {files:(AlternativeGroupFileIdentity&{before:string;after:string})[];baselineDigest:string;manifestDigests:{baseline:string;alternative:string}}
export interface AlternativeLaunchRequest {root:string;nodePath:string;args:string[];token:string}
export const ALTERNATIVE_WORKSPACE_LIMITS:Readonly<{entries:number;bytes:number;fileBytes:number;nativeDependencyBytes:number;manifestBytes:number;sourceBytes:number}>;
export function alternativePathExcluded(path:string,directory:boolean):boolean;
export function createAlternativeWorkspaces(options:{storageRoot:string;root:string;projectId:string;nodePath?:string;isCurrent?:()=>boolean}):{
 prepare(input:{comparisonId:string;path:string;before:string;after:string;guard?:()=>Promise<void>|void}):Promise<PreparedAlternativeWorkspaces>;
 prepareGroup(input:{comparisonId:string;files:{path:string;before:string;after:string}[];guard?:()=>Promise<void>|void}):Promise<PreparedAlternativeGroupWorkspaces>;
 readGroup(comparisonId:string,options?:{guard?:()=>Promise<void>|void;originalBatchWrite?:OriginalBatchWrite}):Promise<RetainedAlternativeGroup>;
 validateOriginalProgress(comparisonId:string,options?:{guard?:()=>Promise<void>|void;originalBatchWrite?:OriginalBatchWrite}):Promise<{manifestDigest:string;files:number;bytes:number}>;
 resolveVariant(comparisonId:string,variantId:'baseline'|'alternative',options?:{guard?:()=>Promise<void>|void}):Promise<AlternativeVariant>;
 validate(comparisonId:string,variantId:'baseline'|'alternative',expectedManifestDigest?:string,options?:{guard?:()=>Promise<void>|void}):Promise<AlternativeVariant>;
 validateOriginal(comparisonId:string,options?:{guard?:()=>Promise<void>|void;originalWriteTemporary?:OriginalWriteTemporary}):Promise<{manifestDigest:string;files:number;bytes:number}>;
 readSources(comparisonId:string,variantId:'baseline'|'alternative',paths:string[],options?:{guard?:()=>Promise<void>|void}):Promise<{path:string;revision:string}[]>;
 readPair(comparisonId:string,options?:{guard?:()=>Promise<void>|void;originalWriteTemporary?:OriginalWriteTemporary}):Promise<RetainedAlternativePair>;
 launcher(request:AlternativeLaunchRequest):Promise<ChildProcess>;
 cleanup(comparisonId:string):Promise<void>;
 dispose():void;
};
