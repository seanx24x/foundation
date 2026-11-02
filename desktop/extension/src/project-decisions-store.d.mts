import type {ProjectDecision,ProjectDecisionInput} from '../../../server/project/project-decisions.mjs';
export {PROJECT_DECISION_LIMITS,normalizeProjectDecision,projectDecisionDigest} from '../../../server/project/project-decisions.mjs';
export interface ProjectDecisionsManifest {schemaVersion:1;projectId:string;revision:number;decisions:ProjectDecision[]}
export interface ProjectDecisionsSnapshot extends ProjectDecisionsManifest {storage:{status:'saved'|'saving'|'error'|'unavailable';message?:string}}
export interface ProjectDecisionsStore {snapshot():ProjectDecisionsSnapshot;/** Read-only committed projection; no full-history clone on repeated reads. */presentation():{snapshot:ProjectDecisionsSnapshot;epoch:number};load():Promise<ProjectDecisionsSnapshot>;create(input:ProjectDecisionInput,expectedRevision:number,options?:{isCurrent?:()=>boolean}):Promise<ProjectDecision>;retry():Promise<ProjectDecisionsSnapshot>;dispose():Promise<void>}
export function createProjectDecisionsStore(options:{projectId:string;read:()=>unknown;write:(manifest:ProjectDecisionsManifest)=>PromiseLike<unknown>|unknown;onChange?:()=>void}):ProjectDecisionsStore;
