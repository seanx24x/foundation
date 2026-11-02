export interface DecisionFeature {id:string;title:string;revision:number;paths:string[]}
export interface DecisionScreen {id:string;featureId:string;title:string;targetId:string;route:string;archived:boolean;createdAt:string;updatedAt:string}
export interface DecisionScenario {id:string;screenId:string;title:string;steps:string[];expectedOutcome:string;archived:boolean;createdAt:string;updatedAt:string}
export interface DecisionScope {feature:DecisionFeature;screen:DecisionScreen;scenario:DecisionScenario;definitionRevision:number}
export interface DecisionFile {path:string;beforeHash:string;afterHash:string}
export interface DecisionEvidence {variant:'baseline'|'alternative';run:{id:string;digest:string;status:'completed';assessment:'not-assessed'|'matched'|'not-matched';observationCount:number;requestCount:number;unattributedRequestCount:number;truncated:boolean};replay:{id:string;digest:string;status:'completed'}|null;capture:{id:string;digest:string}|null}
export interface DecisionRecipe {id:string;title:string;route:string;fixture:{id:string;label:string};catalogDigest:string}
export interface DecisionRequested {theme:'light'|'dark';motion:'system'|'reduce';viewportWidthCss:390|768|960;viewportHeightCss:680}
export interface DecisionChoiceBase {comparisonId:string;candidateName:string;comparisonDigest:string;baselineDigest:string;sourceId:string;files:DecisionFile[];scope:DecisionScope;recipe:DecisionRecipe;requested:DecisionRequested;evidence:DecisionEvidence[];compilation:'not-recorded';assessment:'not-assessed';sourceRelationship:'unverified'}
export type DecisionChoice=(DecisionChoiceBase&{kind:'token'})|(DecisionChoiceBase&{kind:'change-set';sourceRevision:number;sourceDigest:string});
export type DecisionAdoption={kind:'token';id:string;appliedAt:string}|{kind:'change-set';id:string;revision:number;checkpointId:string;appliedAt:string};
export interface ProjectDecision {id:string;projectId:string;createdAt:string;title:string;rationale:string;feature:DecisionFeature;choice:DecisionChoice;adoption:DecisionAdoption;contextFiles:{path:string;hash:string}[];supersedes?:string}
export type ProjectDecisionInput=Omit<ProjectDecision,'id'|'createdAt'>;
export interface ProjectDecisionContext {version:1;projectId:string;decisions:{decision:ProjectDecision;digest:string}[]}
export interface ProjectDecisionAssessment {source:'current'|'stale'|'missing';adoption:'applied'|'undone'|'missing';evidence:'available'|'changed'|'missing';supersededBy?:string}
export interface ProjectDecisionAssessmentInput {files:{path:string;hash:string|null}[];dirtyPaths?:string[];adoptionStatus:'applied'|'undone'|'missing';comparisonDigest?:string|null;supersededBy?:string}
export const PROJECT_DECISION_LIMITS:Readonly<{records:32;journalBytes:number;contextRecords:4;contextBytes:number}>;
export function normalizeProjectDecision(value:unknown,options?:{projectId?:string}):ProjectDecision;
export function projectDecisionDigest(value:unknown):string;
/** Canonical metadata fingerprint for host-retained evidence. Does not establish provenance by itself. */
export function projectDecisionEvidenceDigest(value:unknown):string;
export function normalizeProjectDecisionContext(value:undefined,options?:{projectId?:string}):undefined;
export function normalizeProjectDecisionContext(value:unknown,options?:{projectId?:string}):ProjectDecisionContext|undefined;
export function assessProjectDecision(decision:ProjectDecision,current:ProjectDecisionAssessmentInput):ProjectDecisionAssessment;
