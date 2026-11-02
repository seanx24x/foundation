import {createHash} from 'node:crypto';
import {createAIAlternatives} from '../../server/project/ai-alternatives.mjs';
export const alternativeHash=value=>createHash('sha256').update(value).digest('hex');
export const alternativeSources=()=>[
 {path:'src/SaveButton.tsx',source:'export const label = "Save";\n'},
 {path:'src/theme.css',source:'.button { border-radius: 8px; }\n'},
 {path:'src/profile.ts',source:'export const endpoint = "/api/profile";\n'},
].map(file=>({...file,revision:alternativeHash(file.source).slice(0,16)}));
export function alternativeGenerationFixture(){const at='2026-11-01T12:00:00.000Z',featureId='11111111-1111-4111-8111-111111111111',screenId='22222222-2222-4222-8222-222222222222';return {version:1,count:2,scope:{feature:{id:featureId,title:'Profile',revision:3,paths:alternativeSources().map(file=>file.path)},screen:{id:screenId,featureId,title:'Profile screen',targetId:'vite:dev',route:'/',archived:false,createdAt:at,updatedAt:at},scenario:{id:'33333333-3333-4333-8333-333333333333',screenId,title:'Save profile',steps:['Edit a profile field','Choose Save'],expectedOutcome:'The profile saves.',archived:false,createdAt:at,updatedAt:at},definitionRevision:7}};}
export function alternativeRawFixture(){return {title:'Two saving directions',summary:'Compare explicit and concise save labels.',candidates:[['Explicit','Save profile',12],['Conversational','Save changes',16]].map(([name,label,radius])=>({name,reason:`Use a ${name.toLowerCase()} label and rounded control.`,title:`${name} save action`,summary:'Adjust the shared label and button radius.',edits:[{path:'src/SaveButton.tsx',find:'"Save"',replace:JSON.stringify(label)},{path:'src/theme.css',find:'8px',replace:`${radius}px`}],verification:['Inspect the Save scenario.']}))};}
export function aiAlternativesFixture({projectId='fixture',requestId}={}){const artifact=createAIAlternatives({raw:JSON.stringify(alternativeRawFixture()),files:alternativeSources(),projectId,generation:alternativeGenerationFixture()});if(requestId)for(const candidate of artifact.candidates)candidate.changeSet.requestId=requestId;return artifact;}
