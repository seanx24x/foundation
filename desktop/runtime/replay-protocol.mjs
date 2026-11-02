import { createHash } from 'node:crypto';

/** Self-contained so the same strict metadata contract can run in the development page. */
export function createReplayProtocol() {
  const exact = (v, keys) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v,k));
  const id = v => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(v);
  const hex = v => typeof v === 'string' && /^[a-f0-9]{32}$/.test(v);
  const text = v => typeof v === 'string' && v.length > 0 && v.length <= 120 && v === v.trim() && !/[\x00-\x1f\x7f]/.test(v);
  const route = v => typeof v === 'string' && v.length <= 512 && /^\/[A-Za-z0-9/._~!$&'()*+,;=@-]*$/.test(v) && !v.includes('//') && !v.split('/').some(x=>x==='.'||x==='..') && !/^\/__foundation(?:\/|$)/.test(v);
  const fail = () => { throw new Error('replay-invalid'); };
  const recipes = value => {
    if(!Array.isArray(value)||value.length<1||value.length>12)fail();
    const seen=new Set();const result=value.map(r=>{
      if(!exact(r,['id','title','route','fixture','steps'])||!id(r.id)||seen.has(r.id)||!text(r.title)||!route(r.route)||!exact(r.fixture,['id','label'])||!id(r.fixture.id)||!text(r.fixture.label)||!Array.isArray(r.steps)||r.steps.length>12)fail();
      seen.add(r.id);const steps=new Set();return {id:r.id,title:r.title,route:r.route,fixture:{id:r.fixture.id,label:r.fixture.label},steps:r.steps.map(s=>{if(!exact(s,['id','title'])||!id(s.id)||steps.has(s.id)||!text(s.title))fail();steps.add(s.id);return {id:s.id,title:s.title};})};
    });
    if(new TextEncoder().encode(JSON.stringify(result)).length>16*1024-256)fail();return result;
  };
  const catalog = v => {
    if(!exact(v,['schemaVersion','registrationId','digest','recipes'])||v.schemaVersion!==1||!hex(v.registrationId)||typeof v.digest!=='string'||!/^[a-f0-9]{64}$/.test(v.digest))fail();
    const result={schemaVersion:1,registrationId:v.registrationId,digest:v.digest,recipes:recipes(v.recipes)};
    if(new TextEncoder().encode(JSON.stringify(result)).length>16*1024)fail();return result;
  };
  const requested = v => {if(!exact(v,['theme','motion','viewportWidthCss','viewportHeightCss'])||!['light','dark'].includes(v.theme)||!['system','reduce'].includes(v.motion)||![390,768,960].includes(v.viewportWidthCss)||v.viewportHeightCss!==680)fail();return {...v};};
  const observed = v => {if(!exact(v,['viewportWidthCss','viewportHeightCss','deviceScaleFactor','colorSchemePreference','reducedMotionPreference'])||!['viewportWidthCss','viewportHeightCss'].every(k=>Number.isInteger(v[k])&&v[k]>=1&&v[k]<=4096)||!Number.isFinite(v.deviceScaleFactor)||v.deviceScaleFactor<0.5||v.deviceScaleFactor>4||!['light','dark'].includes(v.colorSchemePreference)||!['reduce','no-preference'].includes(v.reducedMotionPreference))fail();return {...v};};
  const identity = v => {if(!exact(v,['session','viewId','documentId','route','pageVersion'])||![v.session,v.viewId,v.documentId].every(hex)||!route(v.route)||!Number.isSafeInteger(v.pageVersion)||v.pageVersion<1)fail();return {...v};};
  const request = v => {if(!exact(v,['executionId','recipeId','catalogDigest','registrationId','identity','requested'])||!hex(v.executionId)||!id(v.recipeId)||!hex(v.registrationId)||typeof v.catalogDigest!=='string'||!/^[a-f0-9]{64}$/.test(v.catalogDigest))fail();return {executionId:v.executionId,recipeId:v.recipeId,catalogDigest:v.catalogDigest,registrationId:v.registrationId,identity:identity(v.identity),requested:requested(v.requested)};};
  const unit = v => {if(!v||!['prepare','step'].includes(v.phase)||!exact(v,v.phase==='prepare'?['phase']:['phase','stepId'])||v.phase==='step'&&!id(v.stepId))fail();return {...v};};
  return {exact,id,hex,route,recipes,catalog,requested,observed,identity,request,unit};
}
export const replayProtocol=createReplayProtocol();
export const replayCatalogDigest=recipes=>createHash('sha256').update(JSON.stringify(replayProtocol.recipes(recipes))).digest('hex');
export function normalizeReplayCatalog(value){const catalog=replayProtocol.catalog(value);if(catalog.digest!==replayCatalogDigest(catalog.recipes))throw new Error('replay-invalid');return catalog;}
export const REPLAY_LIMITS=Object.freeze({recipes:12,steps:12,catalogBytes:16*1024,unitMs:10000,leaseMs:4000,pollMs:150,executionsPerDocument:64});
