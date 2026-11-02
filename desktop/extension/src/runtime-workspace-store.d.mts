import type { RuntimeObservation } from './connected-runtime.mjs';
export interface RuntimeScreen { id:string;featureId:string;title:string;targetId:string;route:string;archived:boolean;createdAt:string;updatedAt:string }
export interface RuntimeScenario { id:string;screenId:string;title:string;steps:string[];expectedOutcome:string;archived:boolean;createdAt:string;updatedAt:string }
export interface RuntimeRun {
  id:string;
  feature:{id:string;title:string;revision:number;paths:string[]};
  screen:RuntimeScreen;
  scenario:RuntimeScenario;
  definitionRevision:number;
  runtime:{targetId:string;session:string;viewId:string;documentId:string;route:string;pageVersion:number};
  sources:{path:string;revision:string}[];
  dirtyPaths:string[];
  startedAt:string;
  endedAt?:string;
  status:'recording'|'completed'|'cancelled'|'interrupted';
  assessment:'not-assessed'|'matched'|'not-matched';
  note:string;
  interruption?:string;
  observations:RuntimeObservation[];
  truncated:boolean;
}
export interface RuntimeWorkspaceSnapshot {
  schemaVersion:1;projectId:string;revision:number;activeScreenId:string|null;activeScenarioId:string|null;
  screens:RuntimeScreen[];scenarios:RuntimeScenario[];runs:RuntimeRun[];
  storage:{status:'saved'|'saving'|'error'|'unavailable';message?:string};
}
export type CreateScreenInput=Pick<RuntimeScreen,'featureId'|'title'|'targetId'|'route'>;
export type UpdateScreenInput=Partial<Pick<RuntimeScreen,'title'|'targetId'|'route'>>;
export type CreateScenarioInput=Pick<RuntimeScenario,'screenId'|'title'|'steps'|'expectedOutcome'>;
export type UpdateScenarioInput=Partial<Pick<RuntimeScenario,'title'|'steps'|'expectedOutcome'>>;
export type BeginRunInput=Pick<RuntimeRun,'feature'|'screen'|'scenario'|'definitionRevision'|'runtime'|'sources'|'dirtyPaths'>;
export type FinishRunInput={status:'completed'|'cancelled'|'interrupted';assessment?:RuntimeRun['assessment'];note?:string;interruption?:string;observations:RuntimeObservation[];truncated:boolean};
export interface RuntimeWorkspaceStore {
  snapshot():RuntimeWorkspaceSnapshot;
  /** Read-only shared records; use snapshot() for detached copies. */
  presentation():{snapshot:RuntimeWorkspaceSnapshot;epoch:number};
  createScreen(input:CreateScreenInput,expectedRevision:number):Promise<RuntimeWorkspaceSnapshot>;
  updateScreen(id:string,patch:UpdateScreenInput,expectedRevision:number):Promise<RuntimeWorkspaceSnapshot>;
  archiveScreen(id:string,archived:boolean,expectedRevision:number):Promise<RuntimeWorkspaceSnapshot>;
  createScenario(input:CreateScenarioInput,expectedRevision:number):Promise<RuntimeWorkspaceSnapshot>;
  updateScenario(id:string,patch:UpdateScenarioInput,expectedRevision:number):Promise<RuntimeWorkspaceSnapshot>;
  archiveScenario(id:string,archived:boolean,expectedRevision:number):Promise<RuntimeWorkspaceSnapshot>;
  select(screenId:string|null,scenarioId:string|null,expectedRevision:number):Promise<RuntimeWorkspaceSnapshot>;
  /** Optional host-reserved UUID supports durable orchestration without changing saved run records. */
  beginRun(input:BeginRunInput,expectedRevision:number,options?:{id:string}):Promise<RuntimeWorkspaceSnapshot>;
  finishRun(id:string,patch:FinishRunInput):Promise<RuntimeWorkspaceSnapshot>;
  retry():Promise<RuntimeWorkspaceSnapshot>;
  dispose():Promise<void>;
}
export function createRuntimeWorkspaceStore(options:{projectId:string;read:()=>unknown;write:(snapshot:Omit<RuntimeWorkspaceSnapshot,'storage'>)=>PromiseLike<unknown>|unknown;onChange?:()=>void}):RuntimeWorkspaceStore;
export function safeScreenRoute(value:unknown):string;
