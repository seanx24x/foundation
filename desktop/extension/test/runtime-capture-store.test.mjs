import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {createRuntimeCaptureStore,inspectCapturePng,CAPTURE_LIMITS} from '../src/runtime-capture-store.mjs';

// Synthetic protocol fixtures only; these are never represented as real captures.
const id=n=>`11000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function crc(bytes){let value=0xffffffff;for(const byte of bytes){value^=byte;for(let n=0;n<8;n++)value=value&1 ? 0xedb88320^(value>>>1) : value>>>1;}return (value^0xffffffff)>>>0;}
function chunk(type,body=Buffer.alloc(0)){const name=Buffer.from(type),header=Buffer.alloc(4),checksum=Buffer.alloc(4);header.writeUInt32BE(body.length);checksum.writeUInt32BE(crc(Buffer.concat([name,body])));return Buffer.concat([header,name,body,checksum]);}
function fixturePng({color=6,width=2,height=2,filter=0,interlace=0,depth=8,compressed,between=[],tail=Buffer.alloc(0)}={}){
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=depth;header[9]=color;header[12]=interlace;
 const stride=width*(color===2?3:4)+1,scanlines=Buffer.alloc(stride*height);for(let row=0;row<height;row++)scanlines[row*stride]=filter;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',compressed||deflateSync(scanlines)),...between,chunk('IEND'),tail]);
}
const projectId='orbit-local';
const conditions=()=>({viewportWidthCss:800,viewportHeightCss:600,deviceScaleFactor:2,scrollXCss:0,scrollYCss:12,canvasScale:0.75,colorSchemePreference:'dark',reducedMotionPreference:'reduce',appTheme:'unknown',dataState:'unknown',animationState:'unknown'});
const context=(n=1)=>({projectId,runId:id(n),featureId:id(100),screenId:id(101),scenarioId:id(102),startedAt:'2026-10-31T10:00:00.000Z',definitionRevision:4,runtime:{targetId:'vite:dev',session:'a'.repeat(32),viewId:'b'.repeat(32),documentId:'c'.repeat(32),route:'/profile',pageVersion:3},sources:[{path:'src/App.tsx',revision:'d'.repeat(64)}],dirtyPaths:['src/App.tsx']});
const input=(n=1)=>({context:context(n),conditions:conditions(),png:fixturePng(),capturedAt:'2026-10-31T10:00:01.000Z'});
function harness(initial){
 let manifest=initial;const assets=new Map(),events=[];
 const adapters={projectId,read:()=>structuredClone(manifest),write:async value=>{events.push('manifest');manifest=structuredClone(value);},writeAsset:async(key,bytes)=>{events.push('asset');assert.equal(assets.has(key),false);assets.set(key,Buffer.from(bytes));},readAsset:async key=>{events.push('read');if(!assets.has(key))throw new Error('private missing path');return Buffer.from(assets.get(key));}};
 return {assets,events,adapters,store:createRuntimeCaptureStore(adapters),manifest:()=>manifest};
}
const rejected=promise=>assert.rejects(promise,error=>error.name==='RuntimeCaptureError' && !/private|secret|\/Users\//.test(error.message));

test('native RGB and RGBA PNG fixtures have validated dimensions and full digests',()=>{
 for(const color of [2,6]){const bytes=fixturePng({color}),info=inspectCapturePng(bytes);assert.equal(info.widthPx,2);assert.equal(info.heightPx,2);assert.equal(info.byteLength,bytes.length);assert.match(info.sha256,/^[a-f0-9]{64}$/);assert.equal(info.mimeType,'image/png');}
});

test('PNG structure, CRC, data, termination and bounded format failures are rejected',()=>{
 const crcDamage=fixturePng();crcDamage[29]^=1;
 const excessiveLength=fixturePng();excessiveLength.writeUInt32BE(0xffffffff,8);
 const badSignature=fixturePng();badSignature[0]=0;
 const rows=Buffer.alloc(18); // RGBA 2x2 expected filtered bytes.
 const invalid=[crcDamage,excessiveLength,badSignature,fixturePng().subarray(0,-12),fixturePng({tail:Buffer.from([1])}),fixturePng({color:3}),fixturePng({depth:16}),fixturePng({interlace:1}),fixturePng({filter:5}),fixturePng({compressed:Buffer.from('invalid')}),fixturePng({compressed:deflateSync(Buffer.alloc(19))}),fixturePng({compressed:deflateSync(Buffer.alloc(17))}),fixturePng({compressed:Buffer.concat([deflateSync(rows),Buffer.from([0])])}),fixturePng({between:[chunk('ABCD')]}),fixturePng({between:[chunk('tEXt',Buffer.from('note')),chunk('IDAT',Buffer.alloc(0))]})];
 for(const value of invalid)assert.throws(()=>inspectCapturePng(value),{code:'capture-invalid'});
 const tooLarge=fixturePng();tooLarge.writeUInt32BE(CAPTURE_LIMITS.imageDimension+1,16);tooLarge.writeUInt32BE(crc(tooLarge.subarray(12,29)),29);assert.throws(()=>inspectCapturePng(tooLarge),{code:'capture-invalid'});
 assert.throws(()=>inspectCapturePng(Buffer.alloc(CAPTURE_LIMITS.imageBytes+1)),{code:'capture-invalid'});
});

test('asset is written and verified before manifest commit and returned records are detached',async()=>{
 const h=harness(),capture=await h.store.saveCapture(input());
 assert.deepEqual(h.events,['asset','read','manifest']);assert.equal(capture.sourceRelationship,'unverified');assert.equal(capture.image.assetId,capture.id);
 assert.deepEqual(capture.binding.sources,context().sources);assert.equal(capture.conditions.appTheme,'unknown');assert.equal(h.store.snapshot().storage.status,'saved');assert.equal(h.manifest().revision,1);
 capture.binding.sources[0].revision='e'.repeat(64);assert.equal(h.store.snapshot().captures[0].binding.sources[0].revision,'d'.repeat(64));
 const loaded=await h.store.readCapture(capture.id);assert.deepEqual(loaded.png,input().png);loaded.png[0]=0;assert.equal((await h.store.readCapture(capture.id)).png[0],137);
});

test('save snapshots caller bytes and identity before awaiting adapters',async()=>{
 const h=harness(),value=input(),pending=h.store.saveCapture(value);value.png.fill(0);value.context.sources[0].path='changed.ts';value.conditions.appTheme='light';
 const capture=await pending;assert.equal(capture.binding.sources[0].path,'src/App.tsx');assert.equal(capture.conditions.appTheme,'unknown');assert.equal((await h.store.readCapture(capture.id)).png[0],137);
});

test('one capture per observation and a single in-flight save bound pending image memory',async()=>{
 const h=harness();let release;const wait=new Promise(resolve=>release=resolve);const baseWrite=h.adapters.writeAsset;let starts=0;
 h.adapters.writeAsset=async(...args)=>{starts++;if(starts===1)await wait;return baseWrite(...args);};const store=createRuntimeCaptureStore(h.adapters);
 const first=store.saveCapture(input(1));await assert.rejects(store.saveCapture({get png(){assert.fail('Busy saves must not inspect or copy image bytes.');}}),{code:'capture-busy'});await new Promise(resolve=>setImmediate(resolve));assert.equal(starts,1);assert.equal(store.snapshot().storage.status,'saving');assert.equal(store.snapshot().captures.length,0);
 release();const results=[await first,await store.saveCapture(input(2))];assert.equal(store.snapshot().revision,2);assert.deepEqual(store.snapshot().captures.map(item=>item.id),results.map(item=>item.id));
 await assert.rejects(store.saveCapture(input(1)),{code:'capture-already-exists'});assert.equal(h.events.filter(item=>item==='asset').length,2);
});

test('invalid binding or conditions cannot write an asset or expand evidence',async()=>{
 const changes=[value=>value.context.projectId='foreign',value=>value.context.runId='../run',value=>value.context.runtime.session='invalid',value=>value.context.runtime.pageVersion=0,value=>value.context.runtime.route='/profile?secret=1',value=>value.context.sources[0].path='../secret',value=>value.context.sources[0].revision='short',value=>value.context.sources.push({...value.context.sources[0]}),value=>value.context.sources=Array(1),value=>value.context.dirtyPaths=['unselected.ts'],value=>value.conditions.appTheme='dark',value=>value.conditions.dataState='known',value=>value.conditions.animationState='paused',value=>value.conditions.canvasScale=0,value=>value.conditions.deviceScaleFactor=Infinity,value=>value.conditions.scrollXCss=NaN,value=>value.conditions.reducedMotionPreference='disabled',value=>value.conditions.headers={secret:'private'},value=>value.context.nonce='unreviewed-extra',value=>value.capturedAt='yesterday'];
 for(const change of changes){const h=harness(),value=input();change(value);await rejected(h.store.saveCapture(value));assert.deepEqual(h.events,[]);assert.equal(h.store.snapshot().captures.length,0);}
});

test('corrupt or missing assets cannot commit or be returned as verified pixels',async()=>{
 const h=harness();h.adapters.readAsset=async()=>Buffer.from('private corrupted path');const store=createRuntimeCaptureStore(h.adapters);await rejected(store.saveCapture(input()));assert.equal(h.events.includes('manifest'),false);assert.equal(store.snapshot().captures.length,0);
 const good=harness(),capture=await good.store.saveCapture(input());good.assets.set(capture.id,fixturePng({color:2}));await assert.rejects(good.store.readCapture(capture.id),{code:'capture-asset-unavailable'});
 good.assets.delete(capture.id);await rejected(good.store.readCapture(capture.id));assert.equal(good.store.snapshot().captures.length,1);
});

test('asset and manifest adapter failures preserve committed metadata and emit safe messages',async()=>{
 for(const failing of ['writeAsset','write']){
  const h=harness(),first=await h.store.saveCapture(input(1));const before=structuredClone(h.manifest());h.adapters[failing]=async()=>{throw new Error('/Users/private/secret capture bytes');};const store=createRuntimeCaptureStore(h.adapters);
  await rejected(store.saveCapture(input(2)));assert.equal(store.snapshot().storage.status,'error');assert.deepEqual(store.snapshot().captures,[first]);assert.deepEqual(h.manifest(),before);
 }
});

test('failed manifest writes can retry against reloaded metadata without overwriting orphan assets',async()=>{
 const h=harness();let failing=true;const original=h.adapters.write;h.adapters.write=async value=>{if(failing)throw new Error('private');return original(value);};const store=createRuntimeCaptureStore(h.adapters);
 await rejected(store.saveCapture(input()));assert.equal(h.assets.size,1);assert.equal(store.snapshot().captures.length,0);failing=false;await store.saveCapture(input());assert.equal(h.assets.size,2);assert.equal(store.snapshot().captures.length,1);
 // Physical orphan quota belongs to the filesystem adapter, not this manifest.
});

test('uncertain manifest outcomes reload before retry and prevent a second image for that run',async()=>{
 const h=harness(),base=h.adapters.write;h.adapters.write=async value=>{await base(value);throw new Error('private acknowledgement failure');};const store=createRuntimeCaptureStore(h.adapters);
 await rejected(store.saveCapture(input()));assert.equal(store.snapshot().captures.length,0);await assert.rejects(store.saveCapture(input()),{code:'capture-already-exists'});assert.equal(store.snapshot().captures.length,1);assert.equal(h.assets.size,1);
});

test('invalid manifests stay unavailable and are never silently replaced',async()=>{
 const h=harness(),capture=await h.store.saveCapture(input()),base=structuredClone(h.manifest());
 for(const change of [value=>value.projectId='foreign',value=>value.schemaVersion=2,value=>value.revision=-1,value=>value.captures=Array(1),value=>value.captures.push(value.captures[0]),value=>value.captures[0].sourceRelationship='confirmed',value=>value.captures[0].image.assetId=id(90),value=>value.captures[0].image.sha256='short',value=>value.captures[0].binding.sources[0].path='../private']){
  const data=structuredClone(base);change(data);const loaded=harness(data);assert.equal(loaded.store.snapshot().storage.status,'unavailable');await assert.rejects(loaded.store.saveCapture(input(2)),{code:'capture-storage-unavailable'});assert.deepEqual(loaded.events,[]);
 }
 const restored=createRuntimeCaptureStore(h.adapters);assert.equal(restored.snapshot().captures[0].id,capture.id);assert.deepEqual((await restored.readCapture(capture.id)).png,input().png);
});

test('capacity limits refuse extra captures without eviction or new asset writes',async()=>{
 const h=harness(),capture=await h.store.saveCapture(input());
 const copies=(count,size=capture.image.byteLength)=>Array.from({length:count},(_,index)=>{const next=structuredClone(capture);next.id=id(1000+index);next.runId=id(2000+index);next.image.assetId=next.id;next.image.byteLength=size;return next;});
 for(const captures of [copies(40),copies(8,CAPTURE_LIMITS.imageBytes)]){const full=harness({schemaVersion:1,projectId,revision:7,captures});assert.equal(full.store.snapshot().storage.status,'saved');await assert.rejects(full.store.saveCapture(input()),{code:'capture-capacity'});assert.equal(full.store.snapshot().captures.length,captures.length);assert.deepEqual(full.events,[]);}
 const overflow=harness({schemaVersion:1,projectId,revision:7,captures:copies(41)});assert.equal(overflow.store.snapshot().storage.status,'unavailable');
});

test('captured timestamps remain literal rather than asserting clock monotonicity or source equivalence',async()=>{
 const h=harness(),value=input();value.capturedAt='2026-10-31T09:59:59.000Z';const capture=await h.store.saveCapture(value);assert.equal(capture.capturedAt,value.capturedAt);assert.equal(capture.binding.startedAt,value.context.startedAt);assert.equal(capture.sourceRelationship,'unverified');assert.equal(capture.conditions.dataState,'unknown');
});


test('APNG control and frame chunks cannot create animated historical assets',()=>{
 for(const name of ['acTL','fcTL','fdAT'])assert.throws(()=>inspectCapturePng(fixturePng({between:[chunk(name,Buffer.alloc(8))]})),{code:'capture-invalid'});
});

test('canonical reference tokens remain compatible while generated capture identities stay UUIDs',async()=>{
 const h=harness(),value=input();Object.assign(value.context,{runId:'run-baseline',featureId:'profile:save',screenId:'profile-screen',scenarioId:'save.success'});
 const capture=await h.store.saveCapture(value);assert.equal(capture.runId,'run-baseline');assert.equal(capture.featureId,'profile:save');assert.equal(capture.screenId,'profile-screen');assert.equal(capture.scenarioId,'save.success');assert.match(capture.id,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
 const reopened=createRuntimeCaptureStore(h.adapters);assert.equal(reopened.snapshot().storage.status,'saved');assert.equal((await reopened.readCapture(capture.id)).capture.runId,'run-baseline');
});


test('read-only reconciliation finds a committed image after acknowledgement failure before any recapture decision',async()=>{
 const h=harness(),base=h.adapters.write;
 h.adapters.write=async value=>{await base(value);throw new Error('private acknowledgement failure');};
 const store=createRuntimeCaptureStore(h.adapters);
 await rejected(store.saveCapture(input()));
 assert.equal(store.snapshot().storage.status,'error');assert.equal(store.snapshot().captures.length,0);
 const writes=[...h.events],committed=structuredClone(h.manifest());
 const reconciled=store.reconcile();
 assert.equal(reconciled.storage.status,'saved');assert.equal(reconciled.captures.length,1);
 assert.deepEqual(reconciled.captures,committed.captures);assert.deepEqual(h.events,writes,'Inspecting metadata does not write or read image bytes');
 const existing=reconciled.captures.find(item=>item.runId===context().runId);
 assert.ok(existing,'Host can verify this existing asset instead of invoking the native capture command');
 await store.readCapture(existing.id);assert.equal(h.assets.size,1);assert.equal(h.events.filter(item=>item==='asset').length,1);
 reconciled.captures[0].binding.sources[0].path='changed.ts';assert.equal(store.snapshot().captures[0].binding.sources[0].path,'src/App.tsx');
 assert.deepEqual(h.manifest(),committed);
});

test('reconciliation preserves an uncommitted storage error and never writes on inspection',async()=>{
 const h=harness();h.adapters.write=async()=>{throw new Error('failed before commit');};
 const store=createRuntimeCaptureStore(h.adapters);await rejected(store.saveCapture(input()));const before=store.snapshot(),events=[...h.events];
 assert.deepEqual(store.reconcile(),before);assert.equal(store.snapshot().storage.status,'error');assert.deepEqual(h.events,events);assert.equal(h.manifest(),undefined);
});

test('reconciliation observes append-only changes from another instance without discarding earlier captures',async()=>{
 const h=harness(),other=createRuntimeCaptureStore(h.adapters);
 const first=await h.store.saveCapture(input(1));assert.equal(other.snapshot().captures.length,0);
 const events=[...h.events];assert.deepEqual(other.reconcile().captures,[first]);assert.deepEqual(h.events,events);
 const second=await h.store.saveCapture(input(2));assert.deepEqual(other.reconcile().captures,[first,second]);
});

test('reconciliation refuses rollback, deletion, replacement or invalid metadata and retains last valid records',async()=>{
 for(const change of [value=>({...value,revision:0,captures:[]}),value=>({...value,revision:value.revision+1,captures:[]}),value=>({...value,captures:[{...value.captures[0],capturedAt:'2026-10-31T11:00:00.000Z'}]}),value=>({...value,projectId:'foreign'}),()=>undefined]){
  const h=harness(),first=await h.store.saveCapture(input());let disk=structuredClone(h.manifest());
  const store=createRuntimeCaptureStore({...h.adapters,read:()=>structuredClone(disk)});disk=change(disk);
  const events=[...h.events];assert.throws(()=>store.reconcile(),{code:'capture-storage-unavailable'});
  assert.equal(store.snapshot().storage.status,'unavailable');assert.deepEqual(store.snapshot().captures,[first]);assert.deepEqual(h.events,events);
  disk=structuredClone(h.manifest());assert.throws(()=>store.reconcile(),{code:'capture-storage-unavailable'},'Unavailable history is not silently reset');
 }
});

test('reconciliation cannot read or replace metadata while a save is pending',async()=>{
 const h=harness();let release,reads=0;
 const original=h.adapters.writeAsset,gate=new Promise(resolve=>release=resolve);
 const store=createRuntimeCaptureStore({...h.adapters,read:()=>{reads++;return structuredClone(h.manifest());},writeAsset:async(...args)=>{await gate;return original(...args);}});
 const pending=store.saveCapture(input());assert.throws(()=>store.reconcile(),{code:'capture-busy'});assert.equal(reads,1);
 release();await pending;assert.equal(store.reconcile().captures.length,1);assert.equal(reads,2);
});

test('constant-time capture state never reads images, reconciles storage or copies retained metadata',async()=>{
 const h=harness();assert.deepEqual(h.store.state(),{revision:0,storageStatus:'saved'});await h.store.saveCapture(input());const events=[...h.events];for(let i=0;i<1000;i++)assert.deepEqual(h.store.state(),{revision:1,storageStatus:'saved'});const returned=h.store.state();returned.revision=-1;assert.deepEqual(h.store.state(),{revision:1,storageStatus:'saved'});assert.deepEqual(h.events,events);
 const errorStore=createRuntimeCaptureStore({...h.adapters,writeAsset:async()=>{throw Error('PRIVATE');}});await rejected(errorStore.saveCapture(input(2)));assert.deepEqual(errorStore.state(),{revision:1,storageStatus:'error'});
});
