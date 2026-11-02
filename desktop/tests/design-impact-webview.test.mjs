import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';

const root=fileURLToPath(new URL('../../',import.meta.url));
const file={path:'src/SaveButton.tsx',source:'export const SaveButton = () => <button>Save</button>;',revision:'a'.repeat(16),language:'typescriptreact',analysis:{symbols:[],imports:[],consumers:[],requests:[]}};
const css={...file,path:'src/styles/tokens.css',source:':root { --brand: #123456; }',revision:'b'.repeat(16),language:'css'};
const project={id:'impact-fixture',name:'Impact fixture',root:'/fixture',files:[{path:file.path},{path:css.path}]};
const token={id:'brand',path:css.path,revision:css.revision,name:'--brand',occurrence:0,scope:':root',line:1,value:'#123456'};
const second={...token,id:'radius',name:'--radius',value:'8px',line:2};
const target={kind:'token',path:token.path,revision:token.revision,name:token.name,occurrence:0};
const ref=(path,revision,line=1)=>({path,revision,line,column:1,endLine:line,endColumn:8});
const related=[{featureId:'save',featureTitle:'Save profile',screenId:'profile',screenTitle:'Profile',scenarioId:'failure',scenarioTitle:'Recover after a failed save',paths:[file.path],suiteNames:['Loading and error']}];
function result(selected=target,extra={}){
 return {schemaVersion:1,projectId:project.id,target:selected,scope:{kind:selected.kind==='token'?'css-declaration':'source-file',label:':root declaration',source:ref(selected.path,selected.revision)},manifest:[ref(file.path,file.revision),ref(css.path,css.revision)],basisDigest:'c'.repeat(64),analyzedAt:'2026-10-31T12:00:00.000Z',consumers:[{id:'consumer',kind:'render',from:ref('src/App.tsx','d'.repeat(16),8),to:{...ref(file.path,file.revision),label:'SaveButton'},provenance:'source'}],tokenReferences:selected.kind==='token'?[{id:'token-use',name:'--brand',scope:'.save-button',property:'background',source:ref(css.path,css.revision,6),provenance:'source'}]:[],declarations:[{id:'decl',name:'--brand',occurrence:0,scope:':root',value:'#123456',selected:true,source:ref(css.path,css.revision)},{id:'decl-dark',name:'--brand',occurrence:1,scope:'.dark',value:'#abcdef',selected:false,source:ref(css.path,css.revision,4)}],limits:[{kind:'cascade',detail:'Cascade resolution is unverified.'}],truncated:false,counts:{indexed:3,analyzed:3,consumers:1,tokenReferences:1,declarations:2},...extra};
}
const ready=(selected=target,extra={})=>({status:'ready',id:'impact-one',target:selected,result:result(selected),relatedScenarios:related,message:'',dirtyPaths:[],...extra});
async function fixture(t,{theme='dark',width=1100,height=1000}={}){
 const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/theme.css'){const values=JSON.parse(await readFile(join(root,`desktop/extension/themes/foundation-${theme}.json`),'utf8'));res.setHeader('Content-Type','text/css');res.end(`:root{${Object.entries(values.colors).map(([key,value])=>`--vscode-${key.replaceAll('.','-')}:${value};`).join('')}}`);}
  else if(['/webview.js','/webview.css','/workspace-model.js','/artifact-model.js'].includes(url.pathname)||/^\/fonts\/[a-z-]+\.woff2$/.test(url.pathname)){res.setHeader('Content-Type',url.pathname.endsWith('.js')?'application/javascript':url.pathname.endsWith('.css')?'text/css':'font/woff2');res.end(await readFile(join(root,'desktop/extension/media',url.pathname.slice(1))));}
  else {res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/webview.css"></head><body data-foundation-surface="workspace" data-foundation-assistant="external"><div id="foundation-root"></div><script src="/workspace-model.js"></script><script src="/artifact-model.js"></script><script src="/webview.js"></script></body></html>');}
 }catch(error){res.writeHead(500).end(error.message);}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width,height}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));assert.deepEqual(errors,[]);});
 await page.addInitScript(()=>{window.outbound=[];window.acquireVsCodeApi=()=>({getState:()=>({mode:'Refine'}),setState:()=>{},postMessage:value=>outbound.push(value)});});
 let current={type:'state',project,activeFile:file,openFiles:[file,css],trusted:true,dirtyPaths:[],provider:{configured:false},changes:[],design:{status:'ready',entry:file.path,entries:[file.path],session:'design-one',html:'<!doctype html><button>Save</button>',compilation:'passed',tokens:[token,second]}};
 const send=data=>page.evaluate(message=>new Promise(resolve=>{addEventListener('message',function receive(event){if(event.source!==window||event.data?.type!==message.type)return;removeEventListener('message',receive);resolve();});postMessage(message,location.origin);}),data);
 const state=updates=>{current={...current,...updates};return send(current);};
 const panel=()=>page.getByRole('region',{name:'Token change impact',exact:true});
 const ensure=async()=>{if(!await page.locator('.design-inspector').isVisible())await page.getByRole('button',{name:'Inspector',exact:true}).click();};
 const select=async()=>{await ensure();await page.locator('.design-token').filter({hasText:'--brand'}).click();};
 const outbound=()=>page.evaluate(()=>structuredClone(window.outbound));
 await page.goto(`http://127.0.0.1:${server.address().port}`);await state();await select();return {page,state,send,panel,ensure,select,outbound,current:()=>current};
}

test('impact inspection is explicit, scoped, keyboard accessible and required before preparing a token proposal',async t=>{
 const f=await fixture(t),{page}=f,input=page.getByRole('textbox',{name:'Experiment value for --brand'}),review=page.getByRole('button',{name:'Review token change',exact:true});
 await input.fill('#abcdef');await expect(review).toBeDisabled();assert.equal((await f.outbound()).filter(item=>['designImpact','designPropose','ask'].includes(item.type)).length,0);
 const inspect=page.getByRole('button',{name:'Inspect change impact',exact:true});await inspect.focus();await inspect.press('Space');assert.deepEqual((await f.outbound()).filter(item=>item.type==='designImpact'),[{type:'designImpact',action:'analyze',target}]);await expect(f.panel()).toHaveAttribute('aria-busy','true');await expect(input).toBeEnabled();await expect(review).toBeDisabled();
 await f.state({designImpact:ready()});await expect(review).toBeEnabled();await expect(inspect).toBeFocused();await expect(f.panel()).toContainText('Shared token declaration');await expect(f.panel()).toContainText('CSS cascade');
 await page.getByText('Source uses · 2',{exact:true}).click();const source=page.getByRole('button',{name:'Open background · .save-button at src/styles/tokens.css:6',exact:true});await source.click();assert.deepEqual((await f.outbound()).filter(item=>item.type==='designImpact').at(-1),{type:'designImpact',action:'navigate',id:'impact-one',evidenceId:'token-use',target:'source'});
 await page.getByText('Scenarios to check · 1',{exact:true}).click();await expect(f.panel()).toContainText('Linked by feature membership. These scenarios have not been exercised');await expect(f.panel()).toContainText('Recover after a failed save');await expect(f.panel()).toContainText('Named suites: Loading and error');
 await review.click();assert.deepEqual((await f.outbound()).filter(item=>item.type==='designPropose'),[{type:'designPropose',impactId:'impact-one',path:css.path,revision:css.revision,name:token.name,occurrence:0,value:'#abcdef'}]);assert.equal((await f.outbound()).filter(item=>['ask','runtimeReplay','runtimeMatrix','runtimeStateSuite'].includes(item.type)).length,0);
});

test('incomplete input, selection and caret survive loading, ready, dirty and stale source publications',async t=>{
 const f=await fixture(t),{page}=f,input=page.getByRole('textbox',{name:'Experiment value for --brand'}),review=page.getByRole('button',{name:'Review token change',exact:true});
 await input.fill('#');await input.focus();await input.evaluate(node=>{node.setSelectionRange(0,1);node.identity='original-input';});
 for(const designImpact of [{status:'loading',id:null,target},ready(),ready(target,{status:'stale',id:null,message:'A dependency changed. Inspect again.'}),ready(target,{dirtyPaths:[file.path]})]){
  await f.state({designImpact});await expect(input).toHaveValue('#');await expect(input).toBeFocused();assert.deepEqual(await input.evaluate(node=>[node.selectionStart,node.selectionEnd,node.identity]),[0,1,'original-input']);await expect(review).toBeDisabled();
 }
 await input.fill('#abcdef');await expect(review).toBeEnabled();await expect(f.panel()).toContainText('Other files have unsaved changes.');
 await f.state({designImpact:ready(),dirtyPaths:[file.path]});await expect(review).toBeEnabled();await page.getByText('Source uses · 2',{exact:true}).click();await expect(page.getByRole('button',{name:'Open Renders SaveButton at src/App.tsx:8',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Open background · .save-button at src/styles/tokens.css:6',exact:true})).toBeEnabled();await f.state({dirtyPaths:[css.path]});await expect(review).toBeDisabled();await expect(page.getByRole('button',{name:'Inspect change impact',exact:true})).toBeDisabled();await f.state({dirtyPaths:[]});await expect(review).toBeEnabled();
 await f.state({designImpact:ready(target,{status:'stale',id:null,message:'Preview identity changed. Inspect again.'})});await expect(review).toBeDisabled();await expect(input).toHaveValue('#abcdef');
 await f.state({designImpact:ready(),design:{...f.current().design,stale:true}});await expect(review).toBeDisabled();await expect(page.getByText('Rebuild the preview before reviewing this change.',{exact:true})).toBeVisible();
});

test('wrong target, changed revision, changed project and missing trust cannot unlock a proposal',async t=>{
 const f=await fixture(t),{page}=f,review=page.getByRole('button',{name:'Review token change',exact:true});await page.getByRole('textbox',{name:'Experiment value for --brand'}).fill('#abcdef');
 for(const designImpact of [ready({...target,name:'--other'}),ready({...target,revision:'e'.repeat(16)}),ready(target,{result:result(target,{projectId:'other-project'})}),null]){await f.state({designImpact});await expect(review).toBeDisabled();await expect(f.panel()).not.toContainText('Source uses');}
 await f.state({designImpact:ready()});await expect(review).toBeEnabled();await page.locator('.design-token').filter({hasText:'--radius'}).click();await page.getByRole('textbox',{name:'Experiment value for --radius'}).fill('12px');await expect(review).toBeDisabled();await expect(f.panel()).not.toContainText('Shared token declaration');
 await f.state({trusted:false});await expect(page.getByRole('button',{name:'Review token change'})).toHaveCount(0);assert.equal((await f.outbound()).filter(item=>item.type==='designPropose').length,0);
});

test('empty, bounded and failed analysis explains limits and offers explicit recovery',async t=>{
 const f=await fixture(t),{page}=f;await f.state({designImpact:ready(target,{result:result(target,{consumers:[],tokenReferences:[],declarations:[],truncated:true}),relatedScenarios:[]})});
 await expect(f.panel()).toContainText('No supported source uses found. This does not establish that the change is isolated.');await expect(f.panel()).toContainText('These results are incomplete.');await page.getByText('Scenarios to check · 0',{exact:true}).click();await expect(f.panel()).toContainText('No saved scenarios');await page.getByText('Analysis details',{exact:true}).click();await expect(f.panel()).toContainText('Cascade resolution is unverified.');
 await page.getByRole('textbox',{name:'Experiment value for --brand'}).fill('#abcdef');await f.state({designImpact:ready(target,{status:'incomplete',id:null,message:'Some saved source is unavailable. Inspect again after recovery.'})});await expect(f.panel()).toContainText('Some saved source is unavailable.');await expect(f.panel()).toContainText('Source uses · 2');await expect(page.getByRole('button',{name:'Review token change',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Inspect change impact',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Inspect change impact',exact:true}).click();assert.deepEqual((await f.outbound()).filter(item=>item.type==='designImpact').at(-1),{type:'designImpact',action:'analyze',target});
 await f.state({designImpact:{status:'error',id:null,target,message:'The source file is unavailable.'}});await expect(f.panel()).toContainText('The source file is unavailable.');await expect(f.panel()).not.toContainText('Source uses');await page.getByRole('button',{name:'Inspect change impact',exact:true}).click();assert.deepEqual((await f.outbound()).filter(item=>item.type==='designImpact').at(-1),{type:'designImpact',action:'analyze',target});
});

test('mapped runtime components expose source-file impact without promising instance isolation',async t=>{
 const f=await fixture(t),{page}=f,component={kind:'component',path:file.path,revision:file.revision};
 const runtime={status:'connected',session:'runtime-one',viewId:'view-one',pageConnected:true,url:'about:blank',target:{id:'web',label:'Web',available:true},targets:[],observations:[],selection:{path:file.path,revision:file.revision,mapping:'resolved',tag:'button',label:'Save',rect:{width:80,height:32},styles:{}}};
 await f.state({runtime});await f.ensure();const panel=page.getByRole('region',{name:'Source change impact',exact:true});await page.getByRole('button',{name:'Inspect source impact',exact:true}).click();assert.deepEqual((await f.outbound()).filter(item=>item.type==='designImpact').at(-1),{type:'designImpact',action:'analyze',target:component});
 await f.state({designImpact:ready(component)});await expect(panel).toContainText('Component source file');await expect(panel).toContainText('Editing one rendered instance is not isolated.');
 await f.state({runtime:{...runtime,selection:{...runtime.selection,mapping:'ambiguous'}}});await expect(panel).toHaveCount(0);await expect(page.getByText('More than one source location matches.',{exact:false})).toBeVisible();
 await f.state({runtime:{...runtime,selection:{...runtime.selection,stale:true}}});await expect(panel).toHaveCount(0);await expect(page.getByText('Source mapping is stale. Select the element again.',{exact:true})).toBeVisible();
});

test('proposal review retains frozen impact evidence and separates historical preflight from verification',async t=>{
 const f=await fixture(t),{page}=f,checkpoint={version:1,result:result(),relatedScenarios:related},proposal={id:'proposal-one',origin:'design',title:'Refine brand color',status:'proposed',path:css.path,baseRevision:css.revision,before:css.source,after:':root { --brand: #abcdef; }',designImpact:checkpoint};
 await f.state({proposal,designImpact:ready({...target,name:'--radius'},{result:result({...target,name:'--radius'},{scope:{kind:'css-declaration',label:'Changed live selection',source:ref(css.path,css.revision)}})})});await page.getByRole('button',{name:'Review',exact:true}).click();const panel=page.getByRole('region',{name:'Reviewed change impact',exact:true});await expect(panel).toContainText('Saved with this proposal. This preflight does not verify the implemented result.');await expect(panel).not.toContainText('Changed live selection');
 await panel.getByText('Source uses · 2',{exact:true}).click();await expect(panel.getByRole('button')).toHaveCount(0);await expect(panel).toContainText('background · .save-button');await f.state({proposal:{...proposal,status:'stale'}});await expect(panel).toContainText('Historical preflight. The source basis changed');await expect(page.getByRole('button',{name:'Apply to source',exact:true})).toHaveCount(0);
});

test('impact details remain legible and keyboard accessible in light, dark and compact inspectors',async t=>{
 await mkdir(join(root,'desktop/tests/artifacts'),{recursive:true});
 for(const theme of ['light','dark']){
  const f=await fixture(t,{theme}),{page}=f;await f.state({designImpact:ready()});await page.getByText('Scenarios to check · 1',{exact:true}).focus();await page.keyboard.press('Enter');await expect(f.panel()).toContainText('Recover after a failed save');await f.state();await expect(page.getByText('Scenarios to check · 1',{exact:true})).toBeFocused();
  await f.panel().scrollIntoViewIfNeeded();await page.screenshot({path:join(root,`desktop/tests/artifacts/design-impact-${theme}.png`)});
  for(const width of [700,320]){await page.setViewportSize({width,height:900});await f.ensure();await f.panel().scrollIntoViewIfNeeded();const geometry=await f.panel().evaluate(node=>({width:node.clientWidth,scroll:node.scrollWidth,rect:node.getBoundingClientRect().toJSON(),children:[...node.querySelectorAll('button,summary')].map(item=>item.getBoundingClientRect().toJSON())}));assert.ok(geometry.scroll<=geometry.width+1);assert.ok(geometry.children.every(rect=>rect.left>=geometry.rect.left-1&&rect.right<=geometry.rect.right+1));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  await page.screenshot({path:join(root,`desktop/tests/artifacts/design-impact-${theme}-narrow.png`)});await page.getByRole('button',{name:'Inspect change impact',exact:true}).focus();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Inspector',exact:true})).toBeFocused();
 }
});
