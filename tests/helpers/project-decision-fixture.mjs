import {randomUUID,createHash} from 'node:crypto';
export const decisionHash=value=>createHash('sha256').update(value).digest('hex');
export function projectDecisionFixture({kind='token',projectId='project-decisions-test'}={}){
 const createdAt='2026-10-31T20:00:00.000Z',appliedAt='2026-10-31T19:59:59.000Z';
 const feature={id:randomUUID(),title:'Save profile',revision:4,paths:['src/theme.css','src/SaveButton.tsx']};
 const screen={id:randomUUID(),featureId:feature.id,title:'Profile',targetId:'vite:dev',route:'/profile',archived:false,createdAt:appliedAt,updatedAt:appliedAt};
 const scenario={id:randomUUID(),screenId:screen.id,title:'Save profile',steps:['Choose Save'],expectedOutcome:'The saved state appears.',archived:false,createdAt:appliedAt,updatedAt:appliedAt};
 const file=path=>({path,beforeHash:decisionHash(`${path}:before`),afterHash:decisionHash(`${path}:after`)});
 const files=kind==='token'?[file(feature.paths[0])]:feature.paths.map(file);
 const evidence=variant=>({variant,run:{id:randomUUID(),digest:decisionHash(`${variant}:observation`),status:'completed',assessment:'not-assessed',observationCount:3,requestCount:1,unattributedRequestCount:0,truncated:false},replay:{id:randomUUID(),digest:decisionHash(`${variant}:replay`),status:'completed'},capture:{id:randomUUID(),digest:decisionHash(`${variant}:capture`)}});
 const choice={kind,comparisonId:randomUUID(),candidateName:'Clear saving state',comparisonDigest:decisionHash('comparison'),baselineDigest:decisionHash('baseline'),sourceId:randomUUID(),...(kind==='change-set'?{sourceRevision:2,sourceDigest:decisionHash('source-group')}:{}),files,scope:{feature:structuredClone(feature),screen,scenario,definitionRevision:3},recipe:{id:'profile-save',title:'Save profile',route:'/profile',fixture:{id:'profile',label:'Profile data'},catalogDigest:decisionHash('recipe')},requested:{theme:'dark',motion:'system',viewportWidthCss:960,viewportHeightCss:680},evidence:[evidence('baseline'),evidence('alternative')],compilation:'not-recorded',assessment:'not-assessed',sourceRelationship:'unverified'};
 const adoption={kind,id:randomUUID(),appliedAt,...(kind==='change-set'?{revision:3,checkpointId:randomUUID()}:{})};
 return {id:randomUUID(),projectId,createdAt,title:'Keep clear saving feedback',rationale:'The explicit saving state makes the request easier to follow.',feature,choice,adoption,contextFiles:feature.paths.map(path=>({path,hash:files.find(item=>item.path===path)?.afterHash??decisionHash(`${path}:supporting`)}))};
}
export function projectDecisionInputFixture(options){const {id,createdAt,...input}=projectDecisionFixture(options);return input;}
