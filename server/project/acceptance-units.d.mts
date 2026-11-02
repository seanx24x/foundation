export interface AcceptancePlan {version:1;groupId:string;groupDigest:string;mode:'partitioned'|'atomic';units:{id:string;label:string;paths:string[]}[];boundaries:string[];digest:string}
export class AcceptanceUnitError extends Error {code:string}
export function createAcceptancePlan(input:{group:any;files:{path:string;revision:string;source:string}[]}):AcceptancePlan;
export function validateAcceptancePlan(value:unknown,group:any):AcceptancePlan;
