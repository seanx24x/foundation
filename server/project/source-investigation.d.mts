export type SourceInvestigationRef = {path:string;revision:string;line:number;column:number;label?:string};
export type SourceInvestigationEdge = {id:string;kind:'import'|'re-export'|'stylesheet'|'call'|'render'|'type-reference'|'test-reference';from:SourceInvestigationRef;to:SourceInvestigationRef;provenance:'source';detail?:string};
export type SourceInvestigationRequest = {id:string;source:SourceInvestigationRef;method:string|null;url:string|null;urlKind:'dynamic'|'literal';provenance:'source'};
export type SourceInvestigationSnapshot = {version:1;id:string;projectId:string;featureId:string;featureRevision:number;anchor:{path:string;revision:string};basisDigest:string;createdAt:string;digest:string;edges:SourceInvestigationEdge[];requests:SourceInvestigationRequest[];boundaries:Array<{kind:'unsupported'|'limit'|'unavailable'|'parse-error'|'unresolved';detail:string}>;counts:{edges:number;requests:number};truncated:boolean};
export type SourceInvestigationDescriptor = {version:1;id:string;digest:string};
export class SourceInvestigationError extends Error {status:number;code:string;}
export function createSourceInvestigation(input:{projectId:string;featureId:string;featureRevision:number;graph:any}):SourceInvestigationSnapshot;
export function validateSourceInvestigation(value:unknown,projectId?:string,context?:Array<{path:string;revision:string;source:string}>):SourceInvestigationSnapshot;
export function sourceInvestigationDigest(value:unknown):string;
export function sourceInvestigationDescriptor(value:unknown):SourceInvestigationDescriptor;
export function normalizeSourceInvestigationDescriptor(value:unknown):SourceInvestigationDescriptor|undefined;
export function sourceInvestigationForProvider(value:unknown):{anchorPath:string;edges:Array<Omit<SourceInvestigationEdge,'from'|'to'>&{from:Omit<SourceInvestigationRef,'revision'>;to:Omit<SourceInvestigationRef,'revision'>}>;requests:Array<Omit<SourceInvestigationRequest,'source'>&{source:Omit<SourceInvestigationRef,'revision'>}>;boundaries:SourceInvestigationSnapshot['boundaries'];counts:SourceInvestigationSnapshot['counts'];truncated:boolean};
