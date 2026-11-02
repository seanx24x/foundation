import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {snapshotMaintainedSource,seedRealProjectHistory,realProjectPaths} from '../scripts/real-project-fixture.mjs';
import {createConversationStore} from '../extension/src/conversation-store.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
async function fixture(t){const temp=await mkdtemp('/private/tmp/foundation-editor-endurance-');t.after(()=>rm(temp,{recursive:true,force:true}));const repo=path.join(temp,'repo');await mkdir(path.join(repo,'src'),{recursive:true});await promisify(execFile)('git',['init','--quiet',repo]);return{repo,workspace:path.join(temp,'workspace')};}
test('real source snapshot preserves exact bytes and reports oversized/unsupported coverage without copying ignored or private files',async t=>{
 const f=await fixture(t);const saved='export const saved = 42;\n',large='/*'+'x'.repeat(256*1024)+'*/\n';
 await Promise.all([writeFile(path.join(f.repo,'src/saved.ts'),saved),writeFile(path.join(f.repo,'src/large.ts'),large),writeFile(path.join(f.repo,'src/types.d.mts'),'export declare const saved: number;\n'),writeFile(path.join(f.repo,'src/ignored.js'),'ignored source'),writeFile(path.join(f.repo,'src/ignored space.js'),'ignored source'),writeFile(path.join(f.repo,'src/ignored\tquoted.js'),'ignored source'),writeFile(path.join(f.repo,'src/.env'),'secret'),writeFile(path.join(f.repo,'src/credentials.json'),'secret'),writeFile(path.join(f.repo,'src/font.woff2'),Buffer.from([0,255])),writeFile(path.join(f.repo,'.gitignore'),'src/ignored*.js\n'),writeFile(path.join(f.repo,'package.json'),'{"private":true}\n')]);
 const result=await snapshotMaintainedSource(f);
 assert.deepEqual(result.files.map(file=>file.path),['.gitignore','package.json','src/large.ts','src/saved.ts','src/types.d.mts']);
 assert.equal(result.files.find(file=>file.path==='src/saved.ts').sha256,sha(saved));assert.equal(await readFile(path.join(f.workspace,'src/saved.ts'),'utf8'),saved);assert.equal(await readFile(path.join(f.workspace,'src/large.ts'),'utf8'),large);
 assert.equal(result.coverage.truncated,true);assert.deepEqual(result.coverage.indexedPaths,['package.json','src/saved.ts']);assert.deepEqual(result.omissions.map(file=>[file.path,file.reason]),[['src/large.ts','exceeds current 256 KiB file limit'],['src/types.d.mts','current adapter does not index .mts files']]);
 for(const name of ['src/ignored.js','src/ignored space.js','src/ignored\tquoted.js'])assert.ok(result.excluded.some(file=>file.path===name&&file.reason==='Git ignored'));assert.ok(result.excluded.some(file=>file.path==='src/credentials.json'));assert.ok(result.excluded.some(file=>file.path==='src/.env'));
 for(const file of result.files)assert.equal(sha(await readFile(path.join(f.repo,file.path))),file.sha256);
});
test('real source snapshot rejects a symlink instead of reading its target',async t=>{const f=await fixture(t);const target=path.join(path.dirname(f.repo),'private.ts');await writeFile(target,'private source');await symlink(target,path.join(f.repo,'src/link.ts'));await assert.rejects(snapshotMaintainedSource(f),/Symbolic link rejected/);});
test('real source snapshot rejects binary bytes disguised as a source file',async t=>{const f=await fixture(t);await writeFile(path.join(f.repo,'src/binary.ts'),Buffer.from([0,65]));await assert.rejects(snapshotMaintainedSource(f),/Binary source rejected/);});
test('real source snapshot cannot target a normal checkout',async()=>{await assert.rejects(snapshotMaintainedSource({repo:path.resolve('.'),workspace:path.resolve('src')}),/private/);});

test('synthetic history starts near rotation while preserving all one hundred seeded turns',async t=>{
 const f=await fixture(t);await mkdir(f.workspace);const source='export const fixture = true;\n';
 for(const name of realProjectPaths.featurePaths){const full=path.join(f.workspace,name);await mkdir(path.dirname(full),{recursive:true});await writeFile(full,source);}
 const userData=path.join(path.dirname(f.workspace),'user-data'),summary=await seedRealProjectHistory({workspace:f.workspace,userData});
 const seed=JSON.parse(await readFile(path.join(path.dirname(f.workspace),'synthetic-history-seed.json'),'utf8'))['foundation.conversations.'+summary.projectId];
 assert.equal(summary.turns,100);assert.equal(summary.activeConversationTurns,28);assert.deepEqual(seed.conversations.map(chat=>chat.turns.length),[8,8,8,8,8,8,8,8,8,28]);
 const store=createConversationStore({projectId:summary.projectId,read:()=>seed,write:async()=>{}});t.after(()=>store.dispose());
 // Compare the production reader's canonical records before and after rotation.
 const original=store.snapshot().conversations.flatMap(chat=>chat.turns);
 for(let n=0;n<2;n++){const requestId=`qualification-${n}`;await store.startTurn({requestId,prompt:'Synthetic qualification request.',intent:'ask',model:'local-fixture',context:[{path:realProjectPaths.sourcePath,source,revision:sha(source).slice(0,16)}]});store.event(requestId,{type:'delta',text:'Local fixture response.'});store.event(requestId,{type:'done'});await store.flush();}
 assert.equal(store.snapshot().conversations.find(chat=>chat.id===seed.activeId).turns.length,30);await store.newConversation();const after=store.snapshot();
 assert.equal(after.conversations.length,11);assert.equal(after.conversations.flatMap(chat=>chat.turns).length,102);assert.notEqual(after.activeId,seed.activeId);
 const restored=new Map(after.conversations.flatMap(chat=>chat.turns).map(turn=>[turn.requestId,turn]));for(const turn of original)assert.deepEqual(restored.get(turn.requestId),turn);
});
