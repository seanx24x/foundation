import type {AlternativeGeneration,AIAlternatives} from '../../../server/project/ai-alternatives.mjs';
import type {ReproducibleIssueContext} from '../../../server/project/reproducible-issues.mjs';
import type {ProjectDecisionContext} from '../../../server/project/project-decisions.mjs';
import type {InvestigationContext,InvestigationDecision,InvestigationAttempt} from '../../../server/project/investigation-continuation.mjs';
import type {SourceInvestigationSnapshot} from '../../../server/project/source-investigation.mjs';
export type ChangeSet = {
  schemaVersion:1; id:string; projectId:string; title:string; summary:string; origin:'ai'; revision:number;
  status:'proposed'|'applying'|'applied'|'undoing'|'undone'|'recovery-required'|'discarded'|'stale';
  files:Array<{id:string;path:string;before:string;after:string;baseRevision:string;appliedRevision?:string}>;
  context:Array<{path:string;revision:string}>; verification:string[]; verificationStatus:'not-run';
  requestId?:string; createdAt?:string; updatedAt?:string;
};
export type ConversationTurnState = 'running' | 'stopping' | 'complete' | 'stopped' | 'failed' | 'interrupted';
export type AssistantIntent = 'ask' | 'plan' | 'build' | 'review';
export type SourceSnapshot = { id: string; path: string; revision: string; source: string; lines: number };
export type ArtifactReference = {sourceId:string;path:string;revision:string;line:number;endLine:number};
export type AssistantArtifactBase = {schemaVersion:1;id:string;projectId:string;title:string;summary:string;context:Array<Omit<SourceSnapshot,'source'>>;verificationStatus:'not-run'};
export type PlanArtifact = AssistantArtifactBase & {steps:Array<{id:string;title:string;detail:string;references:ArtifactReference[]}>;risks:string[];verification:string[]};
export type ReviewArtifact = AssistantArtifactBase & {findings:Array<{id:string;severity:'high'|'medium'|'low';title:string;detail:string;references:ArtifactReference[];suggestion?:string}>;limitations:string[]};
export type PlanRevisionInput = {title:string;summary:string;steps:Array<{id:string;title:string;detail:string;included:boolean}>;risks:string[];verification:string[]};
export type PlanRevision = PlanRevisionInput & {revision:number;createdAt:string};
export type PlanContextSnapshot = {version:1;conversationId:string;requestId:string;artifactId:string;revision:number;stepId:string;title:string;summary:string;step:{title:string;detail:string;references:ArtifactReference[]};verification:string[]};
export type VerificationRecord = {
  id: string; proposalId: string; revision: string; previewRevision: string; runtimeSession: string;
  recordedAt: string; compilation: 'passed' | 'failed'; interaction: 'not-run'; visual: 'not-run'; observed: boolean; historical: true;
};
export type ProviderKind = 'openai' | 'anthropic' | 'compatible';
export type TaskContextSnapshot = { version: 1; featureId: string; title: string; brief: string; revision: number };
export type RuntimeEvidenceSnapshot = {
  id: string; observationId: string; session: string; kind: 'request'; method: string; url: string;
  status: number | null; durationMs: number; outcome: 'success' | 'http-error' | 'network-error' | 'aborted';
  observedAt: string; correlation: 'unattributed'; provenance: 'observed';
};
export type GroupRevisionSnapshot = { version: 1; conversationId: string; requestId: string; groupId: string; groupRevision: number; groupDigest: string };
export type CheckContextSnapshot = {version:1;conversationId:string;requestId:string;groupId:string;groupRevision:number;groupDigest:string;snapshotRevision:string;tasks:Array<{id:'node:test'|'typescript:check';label:string}>};
export type CheckSuggestion = {schemaVersion:1;id:string;projectId:string;verificationStatus:'not-run';title:string;summary:string;checks:Array<{taskId:'node:test'|'typescript:check';reason:string}>;limitations:string[]};
export type RequestRevisionSnapshot = { version: 1; conversationId: string; requestId: string };
export type ConversationTurn = {
  id: string; requestId: string; question: string; intent: AssistantIntent; context: SourceSnapshot[];
  answer: string; state: ConversationTurnState; model: string; started: boolean; createdAt: string; updatedAt: string;
  providerKind?: ProviderKind; runtimeEvidenceVersion?: 1; runtimeEvidence?: RuntimeEvidenceSnapshot[];
  investigationContext?:InvestigationContext; investigationDecision?:InvestigationDecision; investigationAttempts?:InvestigationAttempt[]; investigationEnded?:{at:string}; sourceInvestigation?: SourceInvestigationSnapshot; taskContext?: TaskContextSnapshot; decisionContext?: ProjectDecisionContext; issueContext?: ReproducibleIssueContext; requestRevision?: RequestRevisionSnapshot; groupRevision?: GroupRevisionSnapshot; checkContext?:CheckContextSnapshot; checkSuggestion?:CheckSuggestion; checkDismissed?:true;
  planContext?: PlanContextSnapshot; plan?: PlanArtifact; planRevisions?: PlanRevision[]; review?: ReviewArtifact;
  usage?: Record<string, number>; error?: string; completedWhileStopping?: boolean;
  alternativeGeneration?:AlternativeGeneration; alternatives?:AIAlternatives; proposal?: any; changeSet?: ChangeSet; verificationHistory: VerificationRecord[];
};
export type Conversation = { id: string; title: string; createdAt: string; updatedAt: string; archived: boolean; turns: ConversationTurn[] };
export type ConversationSnapshot = {
  schemaVersion: 11; projectId: string; revision: number; activeId: string | null; conversations: Conversation[];
  storage: { status: 'saved' | 'saving' | 'error' | 'unavailable'; message?: string };
};
export type StartTurnInput = { alternativeGeneration?:AlternativeGeneration; requestId: string; prompt: string; intent?: AssistantIntent; context: Array<{ path: string; revision: string; source: string }>;
  model?: string; conversationId?: string | null; providerKind?: ProviderKind; runtimeEvidenceVersion?: 1; runtimeEvidence?: RuntimeEvidenceSnapshot[]; taskContext?: TaskContextSnapshot; decisionContext?: ProjectDecisionContext; issueContext?: ReproducibleIssueContext; planContext?: PlanContextSnapshot; requestRevision?: RequestRevisionSnapshot; groupRevision?: GroupRevisionSnapshot; checkContext?:CheckContextSnapshot; sourceInvestigation?:SourceInvestigationSnapshot; investigationContext?:InvestigationContext };
export type VerificationInput = { revision: string; previewRevision: string; runtimeSession?: string; session?: string;
  recordedAt?: string; compilation: 'passed' | 'failed'; interaction?: 'not-run'; visual?: 'not-run'; observed?: boolean };
export type ConversationStore = {
  snapshot(): ConversationSnapshot;
  /** Read-only shared records; use snapshot() for detached copies. */
  presentation(): {snapshot:ConversationSnapshot;epoch:number;versions:Readonly<Record<string,number>>};
  newConversation(): Promise<Conversation>;
  select(id: string): Promise<ConversationSnapshot>;
  archive(id: string, archived?: boolean): Promise<ConversationSnapshot>;
  startTurn(input: StartTurnInput): Promise<ConversationTurn>;
  event(requestId: string, event: any): ConversationTurn | null;
  flush(): Promise<void>;
  retry(): Promise<ConversationSnapshot>;
  startInvestigationAttempt(input:{conversationId:string;requestId:string;decisionId:string;attemptId:string}):Promise<ConversationSnapshot>;
  finishInvestigationAttempt(input:{conversationId:string;requestId:string;attemptId:string;status:'complete'|'failed'|'stopped';result?:SourceInvestigationSnapshot;reason?:string}):Promise<ConversationSnapshot>;
  endInvestigationChain(input:{conversationId:string;rootRequestId:string;expectedLatestRequestId:string}):Promise<ConversationSnapshot>;
  dismissCheckSuggestion(input:{conversationId:string;requestId:string;artifactId:string}):Promise<ConversationSnapshot>;
  revisePlan(input:{conversationId:string;requestId:string;expectedRevision:number;input:PlanRevisionInput}):Promise<ConversationSnapshot>;
  updateProposal(proposal: any): Promise<any>;
  updateChangeSet(changeSet: ChangeSet | null): Promise<ChangeSet | null>;
  recordVerification(proposalId: string, evidence: VerificationInput): Promise<VerificationRecord | null>;
  dispose(): Promise<void>;
};
export function createConversationStore(options: {
  projectId: string; read: () => unknown; write: (snapshot: Omit<ConversationSnapshot, 'storage'>) => PromiseLike<unknown> | unknown; onChange?: () => void;
}): ConversationStore;
