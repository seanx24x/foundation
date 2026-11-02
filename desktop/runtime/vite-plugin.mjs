import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { runtimeClient } from './client.mjs';
import { runtimeReplayClient } from './replay-client.mjs';
import { createReplayProtocol } from './replay-protocol.mjs';
import { createReplayMailbox } from './replay-mailbox.mjs';
import { safeScreenRoute } from '../extension/src/runtime-workspace-store.mjs';

const PREFIX = '/__foundation/';
const MAX_EVENTS = 100;
const MAX_INPUT = 16 * 1024;
const safePath = value => typeof value === 'string' && value.length < 1024 && !path.isAbsolute(value) && !value.split('/').includes('..') && !value.includes('\\') && !value.includes('\0');
const digest = value => createHash('sha256').update(value).digest('hex');
const cleanURL = value => {
  try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.href.slice(0, 1024); } catch { return null; }
};

// High-resolution v3 source map for insertion-only instrumentation. Source text
// and line breaks are unchanged; inserted attributes map to their insertion point.
function insertionMap(code, inserts, filename) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const vlq = number => { let value=number<0?(-number*2)+1:number*2, result=''; do {let digit=value%32;value=Math.floor(value/32);if(value)digit|=32;result+=alphabet[digit];}while(value);return result; };
  const positions=new Map(inserts.map(item=>[item.position,item.text.length]));
  const lines=[];let segments=[],line=0,column=0,generated=0,lastGenerated=0,lastLine=0,lastColumn=0;
  const mark=()=>{segments.push(vlq(generated-lastGenerated)+'A'+vlq(line-lastLine)+vlq(column-lastColumn));lastGenerated=generated;lastLine=line;lastColumn=column;};
  for(let index=0;index<code.length;index++) {
    if(positions.has(index)){mark();generated+=positions.get(index);}
    if(code[index]==='\n'){lines.push(segments.join(','));segments=[];line++;column=0;generated=0;lastGenerated=0;}
    else {mark();column++;generated++;}
  }
  lines.push(segments.join(','));
  return {version:3,file:filename,sources:[filename],sourcesContent:[code],names:[],mappings:lines.join(';')};
}

/** Explicit, development-only Vite integration. This plugin does not mutate source files. */
export function foundationRuntime() {
  const session = randomBytes(16).toString('hex');
  const token = process.env.FOUNDATION_RUNTIME_TOKEN || randomBytes(32).toString('hex');
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Foundation runtime token is invalid.');
  const expected = Buffer.from(token);
  const mappings = new Map(), files = new Map();
  let root, version = 0, sequence = 0;
  const makeView = () => ({version:0,selectionVersion:0,selection:null,lastPageSeen:0,lastAccess:Date.now(),documentId:null,pagePath:null,pageVersion:0,pageSequence:0,retiredDocuments:new Set(),observations:[]});
  const views = new Map([['standalone',makeView()]]);
  const changed = () => { version++; };
  const replay=createReplayMailbox({session,changed});
  const snapshot = (viewId, view) => ({ protocol: 1, session, root, viewId, version:version+view.version, pageConnected:Date.now()-view.lastPageSeen<8000, documentId:view.documentId, pagePath:view.pagePath, pageVersion:view.pageVersion, selectionVersion:view.selectionVersion, selection:view.selection,
    observations:view.observations, files: [...files].map(([path, revision]) => ({ path, revision })),
    ...replay.snapshot(view), capabilities: { sourceMapping: 'instrumented', requests: true, screenshots: false, routeTracking: true, scenarioReplay:true } });
  const authorize = request => {
    const actual = Buffer.from(String(request.headers['x-foundation-token'] || '').slice(0, 256));
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };
  const send = (response, status, value) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(JSON.stringify(value));
  };
  const validateSelection = input => {
    if (input === null) return null;
    if (!input || typeof input.id !== 'string' || input.id.length > 80 || !input.rect || !['x','y','width','height'].every(key => Number.isFinite(input.rect[key]) && Math.abs(input.rect[key]) < 100000)) return undefined;
    const mapping = mappings.get(input.mappingId);
    const styles = {};
    for (const key of ['color','backgroundColor','fontSize','fontWeight','lineHeight','padding','gap','borderRadius','display','width','height']) {
      if (typeof input.styles?.[key] === 'string') styles[key] = input.styles[key].slice(0, 200);
    }
    return { id: input.id, mappingId: typeof input.mappingId === 'string' ? input.mappingId.slice(0, 80) : null,
      mapping: mapping ? 'resolved' : 'unavailable', ...(mapping || {}), stale: false,
      tag: String(input.tag || 'element').slice(0, 30), label: String(input.label || 'Selected element').slice(0, 160),
      rect: Object.fromEntries(['x','y','width','height'].map(key => [key, input.rect[key]])), styles };
  };
  return {
    name: 'foundation-runtime', apply: 'serve', enforce: 'pre',
    resolveId(id){if(id==='virtual:foundation/scenarios')return '\0foundation:scenarios';},
    load(id){if(id==='\0foundation:scenarios')return `export function registerFoundationScenarios(value){if(typeof globalThis.__foundationRegisterScenarios!=='function')throw new Error('Foundation scenarios require development instrumentation.');const dispose=globalThis.__foundationRegisterScenarios(value);if(import.meta.hot)import.meta.hot.dispose(dispose);return dispose;}`;},
    configResolved(config) {
      root = realpathSync(config.root);
      if (config.server.host && !['127.0.0.1','localhost','::1'].includes(config.server.host)) throw new Error('Foundation instrumentation requires a loopback development server.');
    },
    transform(code, id) {
      const filename = id.split('?')[0];
      if (!/\.[jt]sx$/.test(filename) || filename.includes('/node_modules/')) return;
      let canonical; try { canonical = realpathSync(filename); } catch { return; }
      const relative = path.relative(root, canonical).split(path.sep).join('/');
      if (!safePath(relative)) return;
      const revision = digest(code);
      for (const [key, value] of mappings) if (value.path === relative) mappings.delete(key);
      files.set(relative, revision);
      const source = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true, filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.JSX);
      if (source.parseDiagnostics.length) return;
      const inserts = [];
      const visit = node => {
        if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName) && /^[a-z]/.test(node.tagName.text)) {
          const occupied = node.attributes.properties.some(prop => ts.isJsxAttribute(prop) && prop.name.getText(source) === 'data-foundation-node');
          if (!occupied) {
            const start = node.getStart(source), line = source.getLineAndCharacterOfPosition(start).line + 1;
            const key = digest(`${relative}:${start}:${node.tagName.text}`).slice(0, 24);
            mappings.set(key, { path: relative, line, revision });
            inserts.push({ position: node.tagName.end, text: ` data-foundation-node="${key}"` });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      for(const view of views.values())if(view.selection?.path===relative&&view.selection.revision!==revision)view.selection={...view.selection,stale:true};
      changed();
      if (!inserts.length) return;
      let output = code;
      for (const insertion of inserts.sort((a,b) => b.position-a.position)) output = output.slice(0,insertion.position)+insertion.text+output.slice(insertion.position);
      return { code: output, map: insertionMap(code, inserts, filename) };
    },
    transformIndexHtml() {
      return [{ tag: 'script', attrs: { type: 'module' }, children: `(${runtimeClient.toString()})(${JSON.stringify({ session, token })},${runtimeReplayClient.toString()},${createReplayProtocol.toString()});`, injectTo: 'head-prepend' }];
    },
    handleHotUpdate(context) {
      for(const view of views.values())replay.sourceChanged(view);
      const relative = path.relative(root, context.file).split(path.sep).join('/');
      if (files.has(relative)) files.delete(relative);
      for (const [key, value] of mappings) if (value.path === relative) mappings.delete(key);
      for(const view of views.values())if(view.selection?.path===relative)view.selection={...view.selection,stale:true};
      changed();
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        let url; try { url = new URL(request.url, 'http://127.0.0.1'); } catch { return next(); }
        if (!url.pathname.startsWith(PREFIX)) return next();
        const address = request.socket.remoteAddress;
        if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address)) return send(response,403,{error:'Loopback only.'});
        let host;try{host=new URL(`http://${request.headers.host}`);}catch{return send(response,403,{error:'Invalid host.'});}
        if(!['127.0.0.1','localhost','[::1]'].includes(host.hostname))return send(response,403,{error:'Host is not loopback.'});
        if (request.headers.origin) {
          let origin; try { origin = new URL(request.headers.origin); } catch { return send(response,403,{error:'Invalid origin.'}); }
          if (!['127.0.0.1','localhost','[::1]'].includes(origin.hostname) || origin.host !== request.headers.host) return send(response,403,{error:'Origin is not this target.'});
        }
        if (request.method === 'GET' && url.pathname === `${PREFIX}handshake`) {
          if (request.headers.origin) return send(response,403,{error:'Handshake belongs to the editor host.'});
          const viewId=String(request.headers['x-foundation-view']||'standalone');
          if(viewId!=='standalone'&&!/^[a-f0-9]{32}$/.test(viewId))return send(response,400,{error:'Invalid runtime view.'});
          if(!views.has(viewId)){
            for(const [id,view] of views)if(id!=='standalone'&&Date.now()-view.lastAccess>60000)views.delete(id);
            if(views.size>=32)return send(response,429,{error:'Too many active runtime views.'});
            views.set(viewId,makeView());
          }
          return send(response,200,{...snapshot(viewId,views.get(viewId)),token});
        }
        if (!authorize(request)) return send(response,403,{error:'Runtime session is not authorized.'});
        if (request.method === 'GET' && url.pathname === `${PREFIX}snapshot`) {
          const viewId=String(request.headers['x-foundation-view']||'standalone'),view=views.get(viewId);
          if(view)view.lastAccess=Date.now();
          return view?send(response,200,snapshot(viewId,view)):send(response,409,{error:'Runtime view expired. Reconnect.'});
        }
        if(request.method==='GET'&&url.pathname===`${PREFIX}replay-command`){
          const view=views.get(String(request.headers['x-foundation-view']||''));
          try{if(!view)throw new Error();return send(response,200,replay.command(view,String(request.headers['x-foundation-document']||''),Number(request.headers['x-foundation-page'])));}catch{return send(response,409,{error:'Replay is no longer current.'});}
        }
        const replayHost=url.pathname===`${PREFIX}replay`,replayEvent=url.pathname===`${PREFIX}replay-events`;
        if(replayHost&&request.headers.origin)return send(response,403,{error:'Replay commands belong to the editor host.'});
        if (request.method !== 'POST' || ![`${PREFIX}events`,`${PREFIX}replay`,`${PREFIX}replay-events`].includes(url.pathname)) return send(response,404,{error:'Unknown runtime endpoint.'});
        if (!/^application\/json(?:;|$)/i.test(String(request.headers['content-type'] || ''))) return send(response,415,{error:'JSON required.'});
        let input, size = 0, chunks = [];
        try {
          for await (const chunk of request) { size += chunk.length; if (size > (replayHost||replayEvent?32*1024:MAX_INPUT)) { send(response,413,{error:'Event too large.'}); return; } chunks.push(chunk); }
          input = JSON.parse(Buffer.concat(chunks));
        } catch { return send(response,400,{error:'Invalid event.'}); }
        if(replayHost){
          const viewId=String(request.headers['x-foundation-view']||''),view=views.get(viewId);
          try{if(!view)throw new Error();return send(response,200,replay.host(view,viewId,input));}catch{return send(response,409,{error:'Replay is no longer current.'});}
        }
        if (!input || input.session !== session) return send(response,409,{error:'Runtime session changed.'});
        const viewId=typeof input.viewId==='string'?input.viewId:'standalone',view=views.get(viewId);
        if(!view)return send(response,409,{error:'Runtime view expired. Reconnect.'});
        if(!/^[a-f0-9]{32}$/.test(input.documentId))return send(response,400,{error:'A runtime document identity is required.'});
        if(view.retiredDocuments.has(input.documentId))return send(response,409,{error:'This runtime document is no longer current.'});
        if(replayEvent){
          try{const result=input.type==='register'?{catalog:replay.register(view,input)}:input.type==='unregister'?replay.unregister(view,input):input.type==='ack'?replay.ack(view,input):null;if(!result)throw new Error();return send(response,202,result);}catch{return send(response,409,{error:'Replay is no longer current.'});}
        }
        if(input.type==='document'||input.type==='ready'){
          let pagePath;try{pagePath=safeScreenRoute(input.pagePath);}catch{pagePath=null;}
          if(!Number.isSafeInteger(input.pageSequence)||input.pageSequence<1||input.pageSequence>1000000000)return send(response,400,{error:'A monotonic page sequence is required.'});
          const newDocument=view.documentId!==input.documentId;
          if(!newDocument&&(input.pageSequence<view.pageSequence||input.pageSequence===view.pageSequence&&pagePath!==view.pagePath))return send(response,409,{error:'This page update is no longer current.'});
          const delta=input.pageSequence-(newDocument?0:view.pageSequence);
          if(!Number.isSafeInteger(view.pageVersion+delta))return send(response,409,{error:'Reconnect after the page version limit.'});
          if(newDocument){
            replay.documentChanged(view);
            if(view.retiredDocuments.size>=64)return send(response,409,{error:'Reconnect after the runtime document limit.'});
            if(view.documentId)view.retiredDocuments.add(view.documentId);
            view.documentId=input.documentId;view.lastPageSeen=0;view.pagePath=null;view.pageSequence=0;view.selection=null;view.observations=[];
          }
          // Count client pathname transitions even when the final path returns
          // before a host poll, or intermediate updates arrive out of order.
          if(delta>0){if(!newDocument)replay.invalidate(view,'route-changed');view.pageVersion+=delta;view.pageSequence=input.pageSequence;view.pagePath=pagePath;view.selection=null;view.observations=[];view.version++;}
          if(input.type==='ready'){const wasConnected=Date.now()-view.lastPageSeen<8000;view.lastPageSeen=Date.now();if(!wasConnected)view.version++;}
          return send(response,202,{accepted:true});
        }
        if(view.documentId!==input.documentId)return send(response,409,{error:'This runtime document is not current.'});
        if((input.type==='selection'||input.type==='pagehide')&&input.pageSequence!==view.pageSequence)return send(response,409,{error:'This event belongs to an earlier page location.'});
        if(input.type==='pagehide'){replay.invalidate(view,'document-hidden');view.lastPageSeen=0;view.version++;return send(response,202,{accepted:true});}
        if (input.type === 'selection') {
          const nextSelection = validateSelection(input.selection);
          if (nextSelection === undefined) return send(response,400,{error:'Invalid selection.'});
          if(input.explicit===true){view.selection=nextSelection;view.selectionVersion++;}
          else if(nextSelection===null){view.selection=null;}
          else if(view.selection?.id===nextSelection.id){
            // Geometry may change after HMR. Only a deliberate new selection can
            // replace source evidence; measurements retain its original revision.
            view.selection={...view.selection,rect:nextSelection.rect,styles:nextSelection.styles,label:nextSelection.label};
          }
          view.version++;
        } else if (input.type === 'request') {
          const safeURL = cleanURL(input.url);
          if (!safeURL || !/^[A-Z]{1,16}$/.test(input.method) || !(input.status === null || Number.isInteger(input.status) && input.status >= 100 && input.status <= 599) || !Number.isFinite(input.durationMs) || input.durationMs < 0 || input.durationMs > 3600000 || !['success','http-error','network-error','aborted'].includes(input.outcome)) return send(response,400,{error:'Invalid request observation.'});
          view.observations.push({ id: `${session}:${viewId}:${++sequence}`, session, documentId:view.documentId, kind:'request', method:input.method, url:safeURL,
            status:input.status, durationMs:Math.round(input.durationMs*10)/10, outcome:input.outcome,
            observedAt:new Date().toISOString(), timing:input.timing === 'response-complete' ? 'response-complete' : 'response-headers', correlation:'unattributed' });
          if(view.observations.length>MAX_EVENTS)view.observations.splice(0,view.observations.length-MAX_EVENTS);view.version++;
        } else return send(response,400,{error:'Unknown event.'});
        send(response,202,{accepted:true});
      });
    },
  };
}

export default foundationRuntime;
