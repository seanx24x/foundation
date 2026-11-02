import {createHash, randomUUID} from 'node:crypto';
import {inflateSync} from 'node:zlib';

export const CAPTURE_LIMITS = Object.freeze({captures:40, imageBytes:16*1024*1024, imagePixels:16_000_000, imageDimension:8192, projectBytes:128*1024*1024, sources:32});
const clone = value => structuredClone(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
const text = (value,max) => typeof value === 'string' && value.length <= max && !value.includes('\0');
const token = value => text(value,200) && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const revision = value => Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
const hex = (value,length) => typeof value === 'string' && value.length === length && /^[a-f0-9]+$/.test(value);
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const path = value => text(value,1024) && value.length > 0 && value.trim() === value && !/[\\:\x00-\x1f\x7f]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..');
const route = value => text(value,512) && /^\/[A-Za-z0-9/._~!$&'()*+,;=@-]*$/.test(value) && !value.includes('//') && !value.split('/').some(part => part === '.' || part === '..') && !/^\/__foundation(?:\/|$)/.test(value);
const finite = (value,min,max) => Number.isFinite(value) && value >= min && value <= max;
const error = (code,message) => Object.assign(new Error(message),{name:'RuntimeCaptureError',code});
const invalid = () => error('capture-invalid','The capture metadata or PNG image could not be validated.');
const requireValue = value => {if(!value)throw invalid();};
const hash = value => createHash('sha256').update(value).digest('hex');

function runtimeValue(value) {
  requireValue(exact(value,['targetId','session','viewId','documentId','route','pageVersion']) && token(value.targetId) && hex(value.session,32) && hex(value.viewId,32) && hex(value.documentId,32) && route(value.route) && revision(value.pageVersion) && value.pageVersion>=1);
  return clone(value);
}
function bindingValue(value) {
  requireValue(exact(value,['startedAt','definitionRevision','runtime','sources','dirtyPaths']) && timestamp(value.startedAt) && revision(value.definitionRevision));
  const runtime=runtimeValue(value.runtime);
  requireValue(Array.isArray(value.sources) && value.sources.length>=1 && value.sources.length<=CAPTURE_LIMITS.sources && Array.from(value.sources).every(item=>exact(item,['path','revision']) && path(item.path) && hex(item.revision,64)) && new Set(value.sources.map(item=>item.path)).size===value.sources.length);
  requireValue(Array.isArray(value.dirtyPaths) && value.dirtyPaths.length<=CAPTURE_LIMITS.sources && Array.from(value.dirtyPaths).every(item=>path(item) && value.sources.some(source=>source.path===item)) && new Set(value.dirtyPaths).size===value.dirtyPaths.length);
  return {startedAt:value.startedAt,definitionRevision:value.definitionRevision,runtime,sources:clone(value.sources),dirtyPaths:[...value.dirtyPaths]};
}
function conditionsValue(value) {
  requireValue(exact(value,['viewportWidthCss','viewportHeightCss','deviceScaleFactor','scrollXCss','scrollYCss','canvasScale','colorSchemePreference','reducedMotionPreference','appTheme','dataState','animationState']) && finite(value.viewportWidthCss,1,16384) && finite(value.viewportHeightCss,1,16384) && finite(value.deviceScaleFactor,0.1,8) && finite(value.scrollXCss,-10_000_000,10_000_000) && finite(value.scrollYCss,-10_000_000,10_000_000) && finite(value.canvasScale,0.1,4) && ['light','dark','no-preference','unknown'].includes(value.colorSchemePreference) && ['reduce','no-preference','unknown'].includes(value.reducedMotionPreference) && value.appTheme==='unknown' && value.dataState==='unknown' && value.animationState==='unknown');
  return clone(value);
}
function contextValue(value,projectId) {
  requireValue(exact(value,['projectId','runId','featureId','screenId','scenarioId','startedAt','definitionRevision','runtime','sources','dirtyPaths']) && value.projectId===projectId && token(value.runId) && token(value.featureId) && token(value.screenId) && token(value.scenarioId));
  return {runId:value.runId,featureId:value.featureId,screenId:value.screenId,scenarioId:value.scenarioId,binding:bindingValue({startedAt:value.startedAt,definitionRevision:value.definitionRevision,runtime:value.runtime,sources:value.sources,dirtyPaths:value.dirtyPaths})};
}
function imageValue(value,id) {
  requireValue(exact(value,['assetId','sha256','byteLength','widthPx','heightPx','mimeType']) && value.assetId===id && hex(value.sha256,64) && Number.isInteger(value.byteLength) && value.byteLength>=57 && value.byteLength<=CAPTURE_LIMITS.imageBytes && Number.isInteger(value.widthPx) && Number.isInteger(value.heightPx) && value.widthPx>0 && value.heightPx>0 && value.widthPx<=CAPTURE_LIMITS.imageDimension && value.heightPx<=CAPTURE_LIMITS.imageDimension && value.widthPx*value.heightPx<=CAPTURE_LIMITS.imagePixels && value.mimeType==='image/png');
  return clone(value);
}
function captureValue(value) {
  requireValue(exact(value,['id','runId','featureId','screenId','scenarioId','capturedAt','binding','image','conditions','sourceRelationship']) && uuid(value.id) && token(value.runId) && token(value.featureId) && token(value.screenId) && token(value.scenarioId) && timestamp(value.capturedAt) && value.sourceRelationship==='unverified');
  return {id:value.id,runId:value.runId,featureId:value.featureId,screenId:value.screenId,scenarioId:value.scenarioId,capturedAt:value.capturedAt,binding:bindingValue(value.binding),image:imageValue(value.image,value.id),conditions:conditionsValue(value.conditions),sourceRelationship:'unverified'};
}
function manifestValue(value,projectId) {
  requireValue(exact(value,['schemaVersion','projectId','revision','captures']) && value.schemaVersion===1 && value.projectId===projectId && revision(value.revision) && Array.isArray(value.captures) && value.captures.length<=CAPTURE_LIMITS.captures);
  const captures=Array.from(value.captures).map(captureValue);
  requireValue(new Set(captures.map(item=>item.id)).size===captures.length && new Set(captures.map(item=>item.runId)).size===captures.length && captures.reduce((sum,item)=>sum+item.image.byteLength,0)<=CAPTURE_LIMITS.projectBytes);
  return {schemaVersion:1,projectId,revision:value.revision,captures};
}

const crcTable=Uint32Array.from({length:256},(_,value)=>{for(let bit=0;bit<8;bit++)value=value&1 ? 0xedb88320^(value>>>1) : value>>>1;return value>>>0;});
function crc32(bytes) {let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
const pngSignature=Buffer.from([137,80,78,71,13,10,26,10]);
/** Structural validation of native RGB/RGBA 8-bit, noninterlaced PNGs. No image recreation. */
export function inspectCapturePng(input) {
  try {
    requireValue(input instanceof Uint8Array && input.byteLength>=57 && input.byteLength<=CAPTURE_LIMITS.imageBytes);
    const bytes=Buffer.from(input.buffer,input.byteOffset,input.byteLength);
    requireValue(bytes.subarray(0,8).equals(pngSignature));
    let offset=8,chunkCount=0,widthPx,heightPx,channels,sawData=false,endedData=false,sawEnd=false,sawPalette=false;
    const data=[];
    while(offset<bytes.length) {
      requireValue(++chunkCount<=4096 && offset+12<=bytes.length);
      const length=bytes.readUInt32BE(offset),end=offset+12+length;
      requireValue(end<=bytes.length);
      const type=bytes.toString('ascii',offset+4,offset+8),body=bytes.subarray(offset+8,end-4);
      requireValue(/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type) && !['acTL','fcTL','fdAT'].includes(type) && crc32(bytes.subarray(offset+4,end-4))===bytes.readUInt32BE(end-4));
      if(chunkCount===1) {
        requireValue(type==='IHDR' && length===13);
        widthPx=body.readUInt32BE(0);heightPx=body.readUInt32BE(4);channels=body[9]===2 ? 3 : body[9]===6 ? 4 : 0;
        requireValue(widthPx>0 && heightPx>0 && widthPx<=CAPTURE_LIMITS.imageDimension && heightPx<=CAPTURE_LIMITS.imageDimension && widthPx*heightPx<=CAPTURE_LIMITS.imagePixels && body[8]===8 && channels && body[10]===0 && body[11]===0 && body[12]===0);
      } else if(type==='IDAT') {
        requireValue(!endedData);sawData=true;data.push(body);
      } else if(type==='IEND') {
        requireValue(length===0 && sawData && end===bytes.length);sawEnd=true;
      } else {
        if(sawData)endedData=true;
        if(type==='PLTE') {requireValue(!sawPalette && !sawData && length>=3 && length<=768 && length%3===0);sawPalette=true;}
        else requireValue(type[0]===type[0].toLowerCase());
      }
      offset=end;
    }
    requireValue(sawEnd);
    const compressed=Buffer.concat(data),stride=widthPx*channels+1,expected=stride*heightPx;
    const inflated=inflateSync(compressed,{maxOutputLength:expected,info:true});
    requireValue(inflated.buffer.length===expected && inflated.engine.bytesWritten===compressed.length);
    for(let row=0;row<heightPx;row++)requireValue(inflated.buffer[row*stride]<=4);
    return {widthPx,heightPx,byteLength:bytes.length,sha256:hash(bytes),mimeType:'image/png'};
  } catch {throw invalid();}
}

/**
 * Assets are local PNG bytes. Host must authorize and guard active-run identity.
 * read() is synchronous. All write/readAsset adapters are asynchronous.
 * writeAsset must atomically create only, reject symlinks, and enforce the actual
 * disk quota including owned orphans. write must atomically replace the manifest.
 */
export function createRuntimeCaptureStore({projectId,read,write,writeAsset,readAsset}) {
  if(!token(projectId) || ![read,write,writeAsset,readAsset].every(item=>typeof item==='function'))throw error('capture-configuration','A project identity and local capture storage adapters are required.');
  const empty=()=>({schemaVersion:1,projectId,revision:0,captures:[]});
  let data=empty(),storage={status:'saved'},inFlight=false;
  const snapshot=()=>({...clone(data),storage:{...storage}});
  function readCommitted() {
    const input=read(),next=input===undefined || input===null ? empty() : manifestValue(input,projectId);
    // Other windows may append captures. Saved records are immutable: a valid
    // schema alone does not authorize rollback, deletion, or replacement.
    requireValue(next.revision>=data.revision && next.captures.length>=data.captures.length && data.captures.every((capture,index)=>JSON.stringify(capture)===JSON.stringify(next.captures[index])));
    requireValue(next.revision!==data.revision || JSON.stringify(next)===JSON.stringify(data));
    requireValue(next.revision===data.revision || next.captures.length>data.captures.length);
    return next;
  }
  function load() {data=readCommitted();storage={status:'saved'};}
  /** Inspect committed metadata before deciding whether a new native capture is needed. */
  function reconcile() {
    if(inFlight)throw error('capture-busy','A capture is already being saved. Wait for it to finish before inspecting its saved state.');
    if(storage.status==='unavailable')throw error('capture-storage-unavailable','Saved capture metadata is unavailable. Existing files have been left unchanged.');
    let next;
    try {next=readCommitted();}
    catch {storage={status:'unavailable',message:'Saved capture metadata could not be recovered safely. Existing records have been left unchanged.'};throw error('capture-storage-unavailable',storage.message);}
    const changed=JSON.stringify(next)!==JSON.stringify(data);
    data=next;
    // An unchanged manifest does not erase an uncommitted write failure.
    // A newly observed committed record resolves an uncertain acknowledgement.
    if(changed || storage.status!=='error')storage={status:'saved'};
    return snapshot();
  }
  try {load();} catch {storage={status:'unavailable',message:'Saved capture metadata could not be read safely. It has been left unchanged.'};}
  async function verifiedAsset(capture) {
    try {
      const bytes=await readAsset(capture.image.assetId),info=inspectCapturePng(bytes);
      requireValue(['widthPx','heightPx','byteLength','sha256','mimeType'].every(key=>info[key]===capture.image[key]));
      return Buffer.from(bytes);
    } catch {throw error('capture-asset-unavailable','The saved image is missing or could not be verified.');}
  }
  function saveCapture(input) {
    if(inFlight)return Promise.reject(error('capture-busy','A capture is already being saved. Wait for it to finish before trying again.'));
    inFlight=true;
    let prepared;
    try {
      requireValue(exact(input,['context','conditions','png','capturedAt']) && timestamp(input.capturedAt));
      const context=contextValue(input.context,projectId),conditions=conditionsValue(input.conditions);
      requireValue(input.png instanceof Uint8Array && input.png.byteLength<=CAPTURE_LIMITS.imageBytes);
      const png=Buffer.from(input.png),image=inspectCapturePng(png);
      prepared={context,conditions,png,image,capturedAt:input.capturedAt};
    } catch {inFlight=false;return Promise.reject(invalid());}
    const operation=Promise.resolve().then(async()=>{
      if(storage.status==='unavailable')throw error('capture-storage-unavailable','Saved capture metadata is unavailable. Existing files have been left unchanged.');
      if(storage.status==='error') {
        try {load();} catch {storage={status:'unavailable',message:'Saved capture metadata could not be recovered safely.'};throw error('capture-storage-unavailable',storage.message);}
      }
      if(data.captures.some(item=>item.runId===prepared.context.runId))throw error('capture-already-exists','This observation already has an immutable capture.');
      if(data.captures.length>=CAPTURE_LIMITS.captures || data.captures.reduce((sum,item)=>sum+item.image.byteLength,0)+prepared.image.byteLength>CAPTURE_LIMITS.projectBytes)throw error('capture-capacity','Local capture storage is full. No saved captures were removed.');
      if(data.revision>=Number.MAX_SAFE_INTEGER-1)throw error('capture-capacity','Capture metadata cannot accept another revision.');
      const id=randomUUID(),capture={id,...prepared.context,capturedAt:prepared.capturedAt,image:{assetId:id,...prepared.image},conditions:prepared.conditions,sourceRelationship:'unverified'};
      const next=manifestValue({...data,revision:data.revision+1,captures:[...data.captures,capture]},projectId);
      storage={status:'saving'};
      try {
        await writeAsset(id,prepared.png);
        await verifiedAsset(capture);
        await write(clone(next));
      } catch {storage={status:'error',message:'The capture could not be saved locally. The active observation can be retried or finished without an image.'};throw error('capture-storage-write',storage.message);}
      data=next;storage={status:'saved'};return clone(capture);
    });
    return operation.finally(()=>{inFlight=false;});
  }
  async function readCapture(id) {
    if(storage.status==='unavailable')throw error('capture-storage-unavailable','Saved capture metadata is unavailable. Existing files have been left unchanged.');
    const capture=uuid(id) && data.captures.find(item=>item.id===id);
    if(!capture)throw error('capture-unknown','Choose a saved capture in the current project.');
    return {capture:clone(capture),png:await verifiedAsset(capture)};
  }
  return Object.freeze({snapshot,state:()=>({revision:data.revision,storageStatus:storage.status}),reconcile,saveCapture,readCapture});
}
