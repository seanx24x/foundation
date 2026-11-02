const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const vscode = require('vscode');
const hash = value => createHash('sha256').update(value).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async (check, label, timeout = 45000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await check(); if (value) return value; await pause(100); }
  throw Error(`Timed out: ${label}`);
};
let inspect;

async function run() {
  const stage = process.env.FOUNDATION_VERIFICATION_STAGE;
  const workspace = process.env.FOUNDATION_VERIFICATION_WORKSPACE;
  const reportPath = process.env.FOUNDATION_VERIFICATION_REPORT;
  assert.ok(['write', 'restore'].includes(stage));
  const extension = vscode.extensions.getExtension('foundation.foundation-workspace');
  assert.ok(extension);
  assert.equal(await fs.realpath(extension.extensionPath), process.env.FOUNDATION_VERIFICATION_EXTENSION);
  await extension.activate();
  await vscode.commands.executeCommand('foundation.refresh');
  inspect = () => extension.exports.inspect();
  assert.ok(process.versions.electron);
  assert.ok((await fs.realpath(process.execPath)).startsWith(process.env.FOUNDATION_VERIFICATION_APP + '/Contents/'));
  assert.equal(inspect().project.root, workspace);
  assert.equal(vscode.workspace.getConfiguration('foundation.ai').get('baseUrl'), '');
  assert.equal(vscode.workspace.getConfiguration('foundation.ai').get('model'), '');
  assert.deepEqual(vscode.workspace.getConfiguration('foundation.ai').get('profiles'), {});
  assert.match(process.env.FOUNDATION_AI_BASE_URL, /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
  assert.equal(process.env.FOUNDATION_AI_MODEL, 'foundation-local-knowledge-fixture');
  for (const key of ['FOUNDATION_AI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) assert.equal(process.env[key], undefined);
  let index = 0;
  const ui = async command => {
    const id = ++index, ipc = process.env.FOUNDATION_VERIFICATION_IPC;
    await fs.writeFile(path.join(ipc, `command-${id}.json`), JSON.stringify(command));
    const result = await wait(async () => {
      try { return JSON.parse(await fs.readFile(path.join(ipc, `result-${id}.json`), 'utf8')); } catch {}
    }, `native ${command.type}`, id === 1 && process.env.FOUNDATION_VERIFICATION_FOCUS_GATE === '1' ? 210000 : 60000);
    assert.equal(result.passed, true, result.error);
    return result.renderer;
  };
  const paths = ['src/App.tsx', 'src/style.css'];
  const sourcePaths = [...paths, 'src/UnrelatedDraft.ts'];
  const cssPath = path.join(workspace, 'src/style.css');
  const draftPath = path.join(workspace, 'src/UnrelatedDraft.ts');
  const originalCSS = await fs.readFile(cssPath, 'utf8');
  const originalApp = await fs.readFile(path.join(workspace, 'src/App.tsx'), 'utf8');
  const originalDraft = await fs.readFile(draftPath, 'utf8');
  const sourceHashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async file => [file, hash(await fs.readFile(path.join(workspace, file)))])));
  const initialHashes = await sourceHashes();
  const proposal = () => inspect().changeSetSession?.current;
  const turns = () => inspect().conversations.conversations.flatMap(chat => chat.turns);
  const canonicalHistory = history => history.map(chat => ({...chat, turns:chat.turns.map(turn => ({...turn,completedWhileStopping:turn.completedWhileStopping===true}))}));
  const state = () => inspect().runtimeWorkspace;
  const alternatives = () => inspect().visualAlternatives;
  const action = (name, fields = {}) => vscode.commands.executeCommand('foundation.runtimeWorkspace', {
    action: name, projectId: inspect().project.id, expectedRevision: state().revision, ...fields,
  });
  const pairScope = '[aria-label="Selected alternative comparison"]';
  const sideScope = name => `${pairScope} [aria-label=${JSON.stringify(name + ' evidence')}]`;
  const assertNoOriginalEvidence = () => {
    assert.equal(state().runs.length, 0);
    assert.equal(inspect().runtimeCaptures.captures.length, 0);
    assert.ok(turns().length <= 3);
  };
  const assertComparison = (renderer, left, right, loaded) => {
    assert.equal(renderer.firstResult, left.id);
    assert.equal(renderer.secondResult, right.id);
    assert.equal(renderer.comparison?.leftId, left.id);
    assert.equal(renderer.comparison?.rightId, right.id);
    assert.ok(renderer.comparison.text.includes(left.candidate.name + ' and ' + right.candidate.name));
    assert.equal(renderer.canvas, false);
    assert.equal(renderer.images.length, 2);
    for (const [offset, record] of [left, right].entries()) {
      const image = renderer.images[offset];
      assert.equal(image.label, record.candidate.name + ' pixel capture');
      if (loaded) {
        const capture = record.variants.find(value => value.id === 'alternative').outcome.capture;
        assert.equal(image.status, 'ready');
        assert.equal(image.sha256, capture.image.sha256, 'Displayed pixels are the exact proposed-side capture');
        assert.equal(image.width, capture.image.widthPx);
        assert.equal(image.height, capture.image.heightPx);
      } else {
        assert.equal(image.status, 'not-loaded', 'Restart must not automatically request image bytes');
        assert.equal(image.width, 0);
        assert.equal(image.sha256, null);
      }
    }
  };

  const issues=()=>inspect().reproducibleIssues;
  const captures=()=>inspect().runtimeCaptures.captures.map(({imageStatus,...record})=>record);
  if(stage==='restore') {
    const previous=JSON.parse(await fs.readFile(reportPath,'utf8'));
    assert.notEqual(process.pid,previous.writeProcessId);assert.equal(inspect().runtime.status,'idle');assert.ok(!state().activeRun);
    assert.equal(alternatives().busy,false);assert.equal(inspect().runtimeReplays.busy,false);assert.deepEqual(await sourceHashes(),previous.finalSourceHashes);
    assert.deepEqual(alternatives().records,previous.records);assert.deepEqual(state().runs,previous.runs);assert.deepEqual(inspect().runtimeReplays.replays,previous.replays);assert.deepEqual(captures(),previous.captures);
    assert.deepEqual(proposal(),previous.retainedGroup);assert.deepEqual(canonicalHistory(inspect().conversations.conversations),previous.history);
    const decision=inspect().projectDecisions.records[0],issue=issues().records[0];assert.deepEqual(decision.record,previous.decision.record);assert.deepEqual(issue.record,previous.issue.record);
    assert.equal(decision.status.source,'stale');assert.equal(decision.canShare,false);assert.equal(issue.status.source,'stale');assert.equal(issue.canShare,true);
    assert.equal(turns().length,2);assert.deepEqual(turns()[1].issueContext,previous.sharedContext);assert.equal(turns()[1].issueContext.issues[0].assessment.source,'current');
    const draft=await vscode.workspace.openTextDocument(vscode.Uri.file(draftPath));await wait(()=>draft.isDirty,'restored unrelated draft');assert.equal(draft.getText(),previous.draftText);assert.equal(await fs.readFile(draftPath,'utf8'),previous.originalDraft);
    await vscode.commands.executeCommand('foundation.understand');const knowledge=await ui({type:'knowledgeInspect',key:'issue:'+issue.record.id});
    assert.equal(knowledge.knowledge.query,previous.finalKnowledge.knowledge.query);assert.equal(knowledge.knowledge.selectedKey,'issue:'+issue.record.id);assert.equal(knowledge.providerRequests,2);assert.equal(knowledge.knowledge.images,0);
    await vscode.commands.executeCommand('foundation.askAI');const context=await ui({type:'knowledgeAssistantInspect'});assert.equal(context.composer,previous.unsentBrief);assert.deepEqual(context.issuesSelected.map(value=>value.id),[issue.record.id]);assert.equal(context.providerRequests,2);assert.equal(context.sendDisabled,false);
    assert.equal(inspect().runtime.status,'idle');assert.deepEqual(await sourceHashes(),previous.finalSourceHashes);assert.equal(draft.getText(),previous.draftText);
    await vscode.commands.executeCommand('foundation.understand');await ui({type:'knowledgeInspect',key:'issue:'+issue.record.id});await ui({type:'screenshot',name:'knowledge-restored',knowledge:true});
    await fs.writeFile(reportPath,JSON.stringify({...previous,restoreProcessId:process.pid,restoredInSecondProcess:true,restoredDraftPreserved:true,restoreNoAutomaticActions:true,restoredKnowledge:knowledge,restoredContext:context,restoredProviderRequests:context.providerRequests,restoreRuntimeStatus:'idle'}));return;
  }

  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  const feature = await vscode.commands.executeCommand('foundation.newFeature', {
    title: 'Profile saving', brief: 'Compare named corner alternatives under the same saved scenario, then review one source change.',
    paths, entryPath: 'src/App.tsx',
  });
  await action('createScreen', { input: { title: 'Profile', targetId: 'vite:dev', route: '/' } });
  const screen = state().screens.find(value => value.featureId === feature.activeId);
  assert.ok(screen);
  await action('createScenario', { input: { screenId: screen.id, title: 'Save profile successfully',
    steps: ['Save the profile.'], expectedOutcome: 'The service acknowledges the save and the profile reports success.' } });
  const scenario = state().scenarios.at(-1);
  await action('select', { screenId: screen.id, scenarioId: scenario.id });
  await action('openScreen', { screenId: screen.id });
  await vscode.commands.executeCommand('foundation.refine');
  await ui({ type: 'prepareCanvas' });
  await wait(() => inspect().runtime.pageConnected && inspect().runtime.replayCatalog?.recipes.some(value => value.id === 'profile-success'), 'original authenticated recipe catalog');
  const originalSession = inspect().runtime.session;
  const draft = await vscode.workspace.openTextDocument(vscode.Uri.file(draftPath));
  const draftEdit = new vscode.WorkspaceEdit();
  draftEdit.insert(draft.uri, new vscode.Position(0, 0), '// Unrelated unsaved scoped verification draft.\n');
  assert.equal(await vscode.workspace.applyEdit(draftEdit), true);
  const draftText = draft.getText();
  const assertPreserved = async () => {
    assert.equal(draft.isDirty, true);
    assert.equal(draft.getText(), draftText);
    assert.equal(await fs.readFile(draftPath, 'utf8'), originalDraft);
  };
  const prepareProposal = async (name, value, label) => {
    const index = turns().length;
    for (const file of paths) {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(workspace, file)));
      await vscode.window.showTextDocument(document, {viewColumn:vscode.ViewColumn.One, preview:false});
    }
    await vscode.commands.executeCommand('foundation.askAI');
    await ui({type:'compose',intent:'build',question:`Create ${name}: set the shared corner radius to ${value} and the save button label to ${label}.`,paths});
    const group = await wait(() => {
      const turn = turns()[index], state = inspect().changeSetSession;
      if (turn && ['failed','stopped','interrupted'].includes(turn.state)) throw Error('Fixture Build failed: ' + JSON.stringify({id:turn.id,state:turn.state,error:turn.error,answerLength:turn.answer?.length||0,context:turn.context?.map(file=>({id:file.id,path:file.path,revision:file.revision}))}));
      return turn?.state === 'complete' && state?.current?.id === turn.changeSet?.id && state.current.status === 'proposed' && !state.busy && state.storage.status === 'saved' && inspect().conversations.storage.status === 'saved' && state.current;
    }, 'saved complete two-file Build group');
    assert.equal(group.origin, 'ai');assert.equal(group.files.length, 2);assert.equal(group.context.length, 2);
    const expected = {'src/App.tsx':originalApp.replace(": 'Save changes'", ": '" + label + "'"), 'src/style.css':originalCSS.replace('--orbit-radius:8px','--orbit-radius:' + value)};
    for (const file of group.files) { assert.equal(file.before, file.path === 'src/App.tsx' ? originalApp : originalCSS);assert.equal(file.after, expected[file.path]); }
    assert.equal(group.verificationStatus,'not-run');
    await vscode.commands.executeCommand('foundation.collapseAssistant');
    await vscode.commands.executeCommand('foundation.review');
    await wait(() => alternatives().groupProposal?.id === group.id && alternatives().groupProposal?.canPrepare, 'current whole-group comparison choice');
    return group;
  };
  const prepareAndRun = async (name, value, label) => {
    const proposed = await prepareProposal(name, value, label);
    const previousIds = alternatives().records.map(record => record.id);
    await ui({ type: 'alternatives' });
    await ui({ type: 'fill', label: 'Alternative name', value: name });
    await ui({ type: 'select', label: 'Comparison scenario', value: scenario.id });
    await ui({ type: 'select', label: 'Comparison recipe', value: 'profile-success' });
    await ui({ type: 'select', label: 'Comparison width', value: '768' });
    await ui({ type: 'select', label: 'Comparison theme', value: 'dark' });
    await ui({ type: 'select', label: 'Comparison motion', value: 'reduce' });
    await ui({ type: 'alternativeCapture' });
    await ui({ type: 'namedButton', label: 'Prepare comparison' });
    let record = await wait(() => alternatives().records.find(record => !previousIds.includes(record.id) && record.status === 'ready'), 'named saved copies', 120000);
    assert.equal(record.candidate.name, name);
    assert.equal(record.source.kind, 'change-set');assert.equal(record.source.groupId, proposed.id);assert.equal(record.source.groupRevision, proposed.revision);
    assert.equal(record.source.files.length, 2);assert.equal(record.candidate.token, undefined);assert.equal(record.path, undefined);assert.equal(record.proposalId, undefined);
    assert.match(record.candidate.metadataDigest, /^[a-f0-9]{64}$/);
    assert.equal(record.captureEach, true);
    for (const file of proposed.files) { const identity=record.source.files.find(value=>value.path===file.path);assert.ok(identity);assert.equal(identity.beforeHash,hash(file.before));assert.equal(identity.afterHash,hash(file.after)); }
    assert.ok(record.variants.every(value => value.status === 'not-run' && !value.runId));
    assert.equal(alternatives().reviewChoices.find(value => value.id === record.id).canReview, false, 'Prepared-only candidate cannot be reviewed');
    assert.equal(inspect().runtime.session, originalSession);
    assert.deepEqual(await sourceHashes(), initialHashes);
    assertNoOriginalEvidence();
    await ui({ type: 'alternatives', details: name + ' · Ready to run' });
    await ui({ type: 'namedButton', label: 'Run comparison', scope: `[data-alternative-record="${record.id}"]` });
    await wait(() => {
      const current = alternatives().records.find(value => value.id === record.id);
      if (current && ['failed', 'cancelled', 'interrupted'].includes(current.status)) throw Error('Comparison ended ' + JSON.stringify(current));
      return current?.status === 'completed' && !alternatives().busy;
    }, 'both actual isolated runtime sides for ' + name, 360000);
    record = alternatives().records.find(value => value.id === record.id);
    assert.equal(record.variants.length, 2);
    for (const side of record.variants) {
      assert.equal(side.status, 'completed');
      assert.equal(side.outcome.replay.status, 'completed');
      assert.equal(side.outcome.observation.status, 'completed');
      assert.equal(side.outcome.observation.assessment, 'not-assessed');
      assert.equal(side.outcome.compilation, 'not-recorded');
      assert.equal(side.outcome.sourceRelationship, 'unverified');
      assert.ok(side.outcome.observation.observations.some(value => value.status === 200 && value.url.endsWith('/api/fixture/success')));
      assert.match(side.outcome.capture.image.sha256, /^[a-f0-9]{64}$/);
      assert.ok(Math.abs(side.outcome.capture.conditions.viewportWidthCss - 768) <= 1);
      for (const file of record.source.files) assert.equal(side.outcome.observation.sources.find(value=>value.path===file.path)?.revision,side.id==='baseline'?file.beforeHash:file.afterHash);
    }
    assert.notEqual(record.variants[0].outcome.capture.image.sha256, record.variants[1].outcome.capture.image.sha256);
    assert.equal(proposal().id, proposed.id);
    assert.equal(inspect().runtime.session, originalSession);
    assert.deepEqual(await sourceHashes(), initialHashes);
    await assertPreserved();
    assertNoOriginalEvidence();
    return { record, proposed };
  };

  const first=await prepareAndRun('Soft save','12px','Save profile');
  await ui({type:'groupAction',id:first.proposed.id,label:'Discard group'});
  await wait(()=>alternatives().reviewChoices.find(value=>value.id===first.record.id)?.canReview,'retained candidate available');
  await ui({type:'alternatives',details:'Soft save · Finished'});
  await ui({type:'namedButton',label:'Review this group',scope:`[data-alternative-record="${first.record.id}"]`});
  const reviewed=await wait(()=>proposal()?.origin==='alternative'&&proposal()?.status==='proposed'&&proposal(),'retained candidate source review');
  assert.equal(reviewed.files.length,2);assert.equal(reviewed.alternativeBasis.comparisonId,first.record.id);assert.deepEqual(await sourceHashes(),initialHashes);
  await vscode.commands.executeCommand('foundation.review');await ui({type:'groupAction',id:reviewed.id,label:'Apply all'});
  await wait(()=>proposal()?.status==='applied'&&!inspect().changeSetSession.busy,'explicit retained group Apply');
  for(const file of reviewed.files)assert.equal(await fs.readFile(path.join(workspace,file.path),'utf8'),file.after);await assertPreserved();
  const appliedHashes=await sourceHashes();await wait(()=>inspect().projectDecisions?.candidate?.canRecord,'applied source decision available');
  await ui({type:'decisionRecord',title:'Choose the softer save shape',rationale:'Use the 12 px shared radius and Save profile label to preserve the action hierarchy.'});
  const decision=await wait(()=>inspect().projectDecisions?.records?.length===1&&!inspect().projectDecisions.busy&&inspect().projectDecisions.records[0],'explicit saved decision');
  assert.equal(decision.canShare,true);assert.equal(decision.status.source,'current');assert.equal(decision.status.adoption,'applied');assert.equal(decision.record.choice.comparisonId,first.record.id);
  // The issue is captured from the adopted project's actual failed request.
  await action('openScreen',{screenId:screen.id});await vscode.commands.executeCommand('foundation.refine');
  await wait(()=>inspect().runtime.pageConnected&&inspect().runtime.replayCatalog?.recipes.some(value=>value.id==='profile-error'),'original adopted source runtime');
  await ui({type:'configure'});await action('beginRun',{scenarioId:scenario.id});const active=state().activeRun;assert.ok(active);
  await ui({type:'startReplay'});const replay=await wait(()=>{const value=inspect().runtimeReplays.replays.find(item=>item.runId===active.id);if(inspect().runtimeReplays.error)throw Error(inspect().runtimeReplays.error);return value?.status==='completed'&&!inspect().runtimeReplays.busy&&value;},'actual error replay');
  await wait(()=>state().activeRun.observations.some(value=>value.status===503),'actual HTTP503 response');
  const runtime=await ui({type:'runtime'});assert.equal(runtime.runtime.state,'error');assert.equal(runtime.providerRequests,1);
  await ui({type:'captureFinish'});const run=await wait(()=>state().runs.find(value=>value.id===active.id&&value.status==='completed'),'explicit capture and finish');
  const capture=captures().find(value=>value.runId===run.id);assert.ok(capture);const assetPath=path.join(process.env.FOUNDATION_VERIFICATION_USER_DATA,'User/globalStorage/foundation.foundation-workspace/runtime-captures',hash(inspect().project.id),'assets',capture.id+'.png'),asset=await fs.readFile(assetPath);assert.equal(hash(asset),capture.image.sha256);assert.equal(asset.length,capture.image.byteLength);assert.equal(asset.readUInt32BE(16),capture.image.widthPx);assert.equal(asset.readUInt32BE(20),capture.image.heightPx);
  await vscode.commands.executeCommand('foundation.understand');await ui({type:'issueRecord',featureId:feature.activeId,runId:run.id,title:'Profile save reports service unavailable',actualOutcome:'After Save profile, the form showed a service-unavailable message and did not confirm a save.'});
  const issue=await wait(()=>issues().records.length===1&&!issues().busy&&issues().records[0],'explicit immutable issue');assert.deepEqual(issue.record.run,run);assert.deepEqual(issue.record.replay.replay,replay);assert.deepEqual(issue.record.capture.capture,capture);assert.equal(issue.status.source,'current');assert.equal(issue.canShare,true);
  assert.deepEqual(await sourceHashes(),appliedHashes);await assertPreserved();
  const all=await ui({type:'knowledgeOpen'});assert.deepEqual(new Set(all.knowledge.results.map(value=>value.key)),new Set(['decision:'+decision.record.id,'issue:'+issue.record.id]));assert.equal(all.providerRequests,1);assert.equal(all.knowledge.images,0);
  const searchTitle=await ui({type:'knowledgeQuery',query:'softer'});assert.deepEqual(searchTitle.knowledge.results.map(value=>value.key),['decision:'+decision.record.id]);
  const searchPath=await ui({type:'knowledgeQuery',query:'src/style.css'});assert.equal(searchPath.knowledge.results.length,2);
  await ui({type:'knowledgeFilter',label:'Knowledge kind',value:'issue'});const filtered=await ui({type:'knowledgeInspect'});assert.deepEqual(filtered.knowledge.results.map(value=>value.key),['issue:'+issue.record.id]);await ui({type:'knowledgeFilter',label:'Knowledge kind',value:'all'});
  const selected=await ui({type:'knowledgeSelect',key:'decision:'+decision.record.id});assert.equal(selected.knowledge.selectedKey,'decision:'+decision.record.id);assert.ok(selected.knowledge.related.some(item=>item.key==='issue:'+issue.record.id));assert.match(selected.knowledge.detailText,/shared source|same feature/i);assert.equal(selected.knowledge.images,0);
  const related=await ui({type:'knowledgeRelated',key:'issue:'+issue.record.id});assert.equal(related.knowledge.selectedKey,'issue:'+issue.record.id);assert.equal(related.providerRequests,1);
  await ui({type:'knowledgeSource',key:'issue:'+issue.record.id,kind:'issue',path:'src/style.css'});await wait(()=>vscode.window.activeTextEditor?.document.uri.fsPath===cssPath,'linked source opens in native editor');assert.deepEqual(await sourceHashes(),appliedHashes);
  await vscode.commands.executeCommand('foundation.understand');await ui({type:'knowledgeOpen'});await ui({type:'knowledgeSelect',key:'issue:'+issue.record.id});
  const evidence=await ui({type:'knowledgeEvidence',key:'issue:'+issue.record.id,runId:run.id});assert.equal(evidence.images.length,0);assert.equal(evidence.providerRequests,1);assert.deepEqual(state().runs,[run]);
  await ui({type:'knowledgeOpen'});await ui({type:'knowledgeSelect',key:'decision:'+decision.record.id});
  const screenshots=[];for(const theme of ['Foundation Dark','Foundation Light']){await vscode.workspace.getConfiguration('workbench').update('colorTheme',theme,vscode.ConfigurationTarget.Global);screenshots.push(await ui({type:'screenshot',name:theme==='Foundation Dark'?'knowledge-dark':'knowledge-light',theme,knowledge:true}));}
  // Prepare the existing Assistant draft before explicit sharing from Knowledge.
  await vscode.commands.executeCommand('foundation.askAI');const brief='Explain the reported failure using this issue and the selected source.';
  const draftBefore=await ui({type:'knowledgeAssistantDraft',question:brief,paths});assert.deepEqual(draftBefore.issuesSelected,[]);assert.deepEqual(draftBefore.decisionsSelected,[]);assert.equal(draftBefore.providerRequests,1);
  await vscode.commands.executeCommand('foundation.understand');await ui({type:'knowledgeOpen'});await ui({type:'knowledgeSelect',key:'issue:'+issue.record.id});
  await ui({type:'knowledgeShare',key:'issue:'+issue.record.id});const prepared=await ui({type:'knowledgeAssistantInspect',issueId:issue.record.id});assert.equal(prepared.composer,brief);assert.deepEqual(prepared.issuesSelected.map(value=>value.id),[issue.record.id]);assert.deepEqual(prepared.decisionsSelected,[]);assert.equal(prepared.providerRequests,1);
  const sharedContext={version:1,projectId:inspect().project.id,issues:[{issue:issue.record,digest:issue.digest,assessment:issues().records[0].status}]};await fs.writeFile(path.join(path.dirname(reportPath),'expected-issue-context.json'),JSON.stringify(sharedContext));
  const sent=await ui({type:'knowledgeSend'});assert.deepEqual(sent.exactIssueContext,sharedContext);await wait(()=>turns().length===2&&turns()[1].state==='complete','explicit knowledge-context Ask');assert.deepEqual(turns()[1].issueContext,sharedContext);assert.equal(turns()[1].decisionContext,undefined);
  const unsentBrief='Explain the historical observation without rerunning it.';await ui({type:'knowledgeAssistantDraft',question:unsentBrief,paths});
  await fs.writeFile(cssPath,(await fs.readFile(cssPath,'utf8'))+'\n/* Knowledge freshness check after recorded decision and issue. */\n');await vscode.commands.executeCommand('foundation.refresh');
  await wait(()=>inspect().projectDecisions.records[0]?.status.source==='stale'&&issues().records[0]?.status.source==='stale','shared source staleness');assert.equal(inspect().projectDecisions.records[0].canShare,false);assert.equal(issues().records[0].canShare,true);assert.deepEqual(inspect().projectDecisions.records[0].record,decision.record);assert.deepEqual(issues().records[0].record,issue.record);assert.deepEqual(turns()[1].issueContext,sharedContext);
  await vscode.commands.executeCommand('foundation.understand');await ui({type:'knowledgeOpen'});const staleDecision=await ui({type:'knowledgeSelect',key:'decision:'+decision.record.id});assert.equal(staleDecision.knowledge.shareDisabled,true);assert.match(staleDecision.knowledge.detailText,/stale/i);
  await ui({type:'knowledgeQuery',query:'service unavailable'});const finalKnowledge=await ui({type:'knowledgeSelect',key:'issue:'+issue.record.id});assert.match(finalKnowledge.knowledge.detailText,/historical/i);assert.equal(finalKnowledge.providerRequests,2);assert.equal(finalKnowledge.knowledge.images,0);await ui({type:'screenshot',name:'knowledge-historical',knowledge:true});
  await assertPreserved();const editor=await vscode.window.showTextDocument(draft,{viewColumn:vscode.ViewColumn.Two,preview:false});editor.selection=new vscode.Selection(0,3,1,9);await vscode.commands.executeCommand('foundation.understand');await ui({type:'knowledgeInspect',key:'issue:'+issue.record.id});
  await fs.writeFile(reportPath,JSON.stringify({writeProcessId:process.pid,projectId:inspect().project.id,featureId:feature.activeId,screenId:screen.id,scenarioId:scenario.id,initialSourceHashes:initialHashes,appliedHashes,finalSourceHashes:await sourceHashes(),originalDraft,draftText,records:[first.record],sourceGroups:[first.proposed],retainedGroup:proposal(),decision,issue,runs:state().runs,replays:inspect().runtimeReplays.replays,captures:captures(),captureAsset:{id:capture.id,sha256:hash(asset),byteLength:asset.length,width:capture.image.widthPx,height:capture.image.heightPx},history:canonicalHistory(inspect().conversations.conversations),sharedContext,unsentBrief,knowledge:{all,searchTitle,searchPath,filtered,selected,related,evidence,screenshots,prepared,sent,staleDecision},finalKnowledge,providerRequests:2,ai:'One genuine Build and one explicit issue-context Ask through a deterministic loopback provider; no remote model or credentials',hardwareAcceptance:'Paused; physical input/display acceptance remains separate',checks:['Genuine retained comparison adoption and user-authored decision','Actual HTTP503 response and PNG form immutable issue','Local title and path search, kind filter and evidence-derived relationships','Explicit knowledge-to-Assistant handoff preserves unsent composer and selected source','One exact issue context only on deliberate Send','Source changes block stale decision and label historical issue','Second-process query/selection/context/draft restoration without automatic runtime/provider/image activity']}));

}

exports.activate = () => {
  const workspace = process.env.FOUNDATION_VERIFICATION_WORKSPACE;
  const outcome = process.env.FOUNDATION_VERIFICATION_OUTCOME;
  assert.equal(vscode.workspace.workspaceFolders?.length, 1);
  assert.equal(vscode.workspace.workspaceFolders[0].uri.fsPath, workspace);
  assert.match(workspace, /^\/private\/tmp\/foundation-project-knowledge-smoke-[A-Za-z0-9]+\/workspace$/);
  assert.equal(path.dirname(outcome), path.dirname(workspace));
  setImmediate(async () => {
    let result;
    try { await run(); result = { passed: true, stage: process.env.FOUNDATION_VERIFICATION_STAGE }; }
    catch (error) {
      result = { passed: false, error: error.stack || String(error), stage: process.env.FOUNDATION_VERIFICATION_STAGE };
      if (inspect) await fs.writeFile(outcome.replace('.json', '-state.json'), JSON.stringify(inspect(), null, 2));
    }
    await fs.writeFile(outcome, JSON.stringify(result, null, 2));
    if (result.passed || process.env.FOUNDATION_VERIFICATION_KEEP_FAILURE !== '1') await vscode.commands.executeCommand('workbench.action.quit');
  });
};
