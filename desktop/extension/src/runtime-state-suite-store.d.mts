import type {ReplayRecipe,ReplayRequested} from './runtime-replay-store.mjs';
export type StateSuiteState='idle'|'loading'|'success'|'error'|'offline';
/** An explicit user label and app-authored recipe, never an inferred or assessed application state. */
export type StateSuiteRecipe=Omit<ReplayRecipe,'registrationId'>;
export interface StateSuiteRow {state:StateSuiteState;recipe:StateSuiteRecipe}
export interface StateSuiteDefinition {id:string;title:string;revision:number;featureId:string;screenId:string;scenarioId:string;states:StateSuiteRow[];requested:ReplayRequested[];captureEach:boolean;createdAt:string;updatedAt:string}
export interface StateSuiteSave {id?:string;title:string;featureId:string;screenId:string;scenarioId:string;states:StateSuiteRow[];requested:ReplayRequested[];captureEach:boolean}
export interface StateSuiteManifest {schemaVersion:1;projectId:string;revision:number;suites:StateSuiteDefinition[]}
export interface StateSuiteSnapshot extends StateSuiteManifest {storage:{status:'saved'|'saving'|'error'|'unavailable';message?:string}}
export interface RuntimeStateSuiteStore {snapshot():StateSuiteSnapshot;save(input:StateSuiteSave,expectedRevision:number):Promise<StateSuiteDefinition>;retry():Promise<StateSuiteSnapshot>;dispose():Promise<void>}
export const STATE_SUITE_STATES:readonly StateSuiteState[];
export const STATE_SUITE_LIMITS:Readonly<{records:20;states:5;cells:12;steps:12;manifestBytes:number}>;
export function createRuntimeStateSuiteStore(options:{projectId:string;read:()=>unknown;write:(value:StateSuiteManifest)=>PromiseLike<unknown>|unknown;onChange?:()=>void}):RuntimeStateSuiteStore;
