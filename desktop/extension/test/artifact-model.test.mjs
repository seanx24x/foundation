import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

const modelURL = process.env.FOUNDATION_ARTIFACT_MODEL
  ? pathToFileURL(process.env.FOUNDATION_ARTIFACT_MODEL)
  : new URL("../media/artifact-model.js", import.meta.url);
const sandbox = { module: { exports: {} }, TextEncoder };
vm.runInNewContext(await readFile(modelURL, "utf8"), sandbox, { filename: modelURL.pathname });
const { freshness, proposalState, verification, acceptsEvent, acceptsConversationSnapshot, verificationHistory } = sandbox.module.exports;
const saved = { path: "src/SaveButton.tsx", revision: "before-42" };
const form = { path: "src/ProfileForm.tsx", revision: "form-10" };
const proposal = {
  id: "proposal-1", path: saved.path, baseRevision: saved.revision,
  status: "proposed", context: [saved, form],
};
const applied = { ...proposal, status: "applied", appliedRevision: "after-43" };
const appliedFile = { ...saved, revision: applied.appliedRevision };
const design = {
  compilation: "passed", observed: true, stale: false, revision: "preview-43",
  files: [appliedFile, form],
};
const envelope = (requestId, type = "delta") => ({type: "ai", requestId, event: {type}});

test("unsaved drafts remain distinct from saved-source freshness", () => {
  const result = freshness([saved, form], [saved, form], [saved.path]);
  assert.equal(result.status, "current");
  assert.equal(result.changed.length, 0);
  assert.equal(result.drafts.length, 1);
  assert.equal(result.drafts[0].path, saved.path);
  assert.equal(saved.revision, "before-42", "evidence mapping must not mutate the saved revision");
});

test("closed files have unknown freshness, while a changed saved dependency makes evidence stale", () => {
  const missing = freshness([saved, form], [saved]);
  assert.equal(missing.status, "unknown");
  assert.equal(missing.missing[0].path, form.path);
  const stale = freshness([saved, form], [{ ...saved, revision: "newer" }]);
  assert.equal(stale.status, "stale");
  assert.equal(stale.changed[0].path, saved.path);
  assert.equal(stale.missing[0].path, form.path);
  assert.equal(freshness([], []).status, "unknown", "no context cannot establish current evidence");
});

test("fresh proposals permit review application but running work and drafts block it", () => {
  assert.equal(proposalState(proposal, [saved, form]).canApply, true);
  assert.equal(proposalState(proposal, [saved, form], [], true).canApply, false);
  for (const path of [saved.path, form.path]) {
    const result = proposalState(proposal, [saved, form], [path]);
    assert.equal(result.canApply, false, `draft in ${path} must block application`);
    assert.equal(result.evidence.status, "current");
    assert.match(result.reason, /Save or discard the editor draft/);
  }
});

test("a change to any selected context blocks a formerly fresh proposal", () => {
  const result = proposalState(proposal, [saved, { ...form, revision: "form-11" }]);
  assert.equal(result.status, "Stale");
  assert.equal(result.canApply, false);
  assert.match(result.reason, /Source changed/);
  assert.equal(proposalState({ ...proposal, status: "stale" }, [saved, form]).canApply, false);
});

test("the target baseline stays authoritative when context omits or contradicts the target", () => {
  for (const context of [[form], [{ ...saved, revision: "manual-44" }, form]]) {
    const result = proposalState({ ...proposal, context }, [{ ...saved, revision: "manual-44" }, form]);
    assert.equal(result.status, "Stale");
    assert.equal(result.canApply, false);
    assert.equal(result.evidence.changed[0].revision, saved.revision);
  }
});

test("old conversation proposals cannot act after their host checkpoint is superseded or dismissed", () => {
  for (const currentId of ["proposal-2", null]) {
    const result = proposalState(proposal, [saved, form], [], false, currentId);
    assert.equal(result.status, "Previous proposal");
    assert.equal(result.canApply, false);
    assert.equal(result.canUndo, false);
    assert.match(result.reason, /read-only/);
  }
  assert.equal(proposalState(null), null);
});

test("applied checkpoints allow undo only before a newer edit, host conflict, or draft", () => {
  assert.equal(proposalState(applied, [appliedFile, form]).canUndo, true);
  assert.equal(proposalState(applied, [appliedFile, form]).canApply, false);
  const changed = proposalState(applied, [{ ...appliedFile, revision: "manual-44" }, form]);
  assert.equal(changed.canUndo, false);
  assert.match(changed.reason, /protect those edits/);
  assert.equal(proposalState({ ...applied, conflict: true }, [appliedFile, form]).canUndo, false);
  assert.equal(proposalState(applied, [appliedFile, form], [saved.path]).canUndo, false);
  assert.equal(proposalState(applied, [appliedFile, form], [], true).canUndo, false);
});

test("terminal proposal states and host-reported blockers have no write action", () => {
  for (const status of ["undone", "discarded", "unavailable"]) {
    const result = proposalState({ ...proposal, status }, [saved, form]);
    assert.equal(result.canApply, false);
    assert.equal(result.canUndo, false);
  }
  for (const item of [proposal, applied]) {
    const result = proposalState({ ...item, reason: "A source file is unavailable." }, [saved, form]);
    assert.equal(result.canApply, false);
    assert.equal(result.canUndo, false);
  }
});

test("compilation credit belongs only to the applied revision, never an older or merely proposed source", () => {
  const matching = verification(applied, design);
  assert.equal(matching.compilation, "passed");
  assert.equal(matching.connected, true);
  assert.equal(matching.revision, "preview-43");
  assert.equal(matching.interaction, "not-run");
  assert.equal(matching.visual, "not-run");
  for (const [item, preview] of [
    [proposal, design],
    [applied, { ...design, files: [saved, form] }],
    [applied, { ...design, files: [{ path: "src/Other.tsx", revision: applied.appliedRevision }] }],
    [applied, { ...design, stale: true }],
    [applied, undefined],
    [null, design],
  ]) {
    const result = verification(item, preview);
    assert.equal(result.compilation, "not-run");
    assert.equal(result.connected, false);
    assert.equal(result.revision, null);
  }
});

test("failed compilation remains failed and an acknowledged render cannot promote verification", () => {
  const failed = verification(applied, { ...design, compilation: "failed", observed: false });
  assert.equal(failed.compilation, "failed");
  assert.equal(failed.connected, false);
  assert.equal(failed.interaction, "not-run");
  assert.equal(failed.visual, "not-run");
  const unknown = verification(applied, { ...design, compilation: "suggested" });
  assert.equal(unknown.compilation, "not-run");
  assert.equal(unknown.interaction, "not-run");
  assert.equal(unknown.visual, "not-run");
});

test("only the current request can receive streamed output or proposal events", () => {
  const turn = {requestId: "request-current", state: "running"};
  for (const type of ["start", "delta", "proposal", "done", "error"]) {
    assert.equal(acceptsEvent(turn, envelope(turn.requestId, type)), true);
    assert.equal(acceptsEvent(turn, envelope("request-old", type)), false);
  }
  assert.equal(acceptsEvent(turn, {type: "ai", event: {type: "delta"}}), false);
  assert.equal(acceptsEvent(turn, {type: "state", requestId: turn.requestId}), false);
  assert.equal(acceptsEvent(null, envelope(turn.requestId)), false);
});

test("stopping accepts a matching terminal acknowledgement without reviving partial output", () => {
  const turn = {requestId: "request-current", state: "stopping"};
  assert.equal(acceptsEvent(turn, envelope(turn.requestId, "cancelled")), true);
  assert.equal(acceptsEvent(turn, envelope("request-old", "cancelled")), false);
  for (const type of ["done", "error"]) {
    assert.equal(acceptsEvent(turn, envelope(turn.requestId, type)), true, `${type} can win the race with cancellation`);
    assert.equal(acceptsEvent(turn, envelope("request-old", type)), false);
  }
  for (const type of ["delta", "proposal", "start"]) {
    assert.equal(acceptsEvent(turn, envelope(turn.requestId, type)), false, `${type} must not revive a stopping request`);
  }
});

test("terminal turns reject late output and cancellation cannot attach to a new turn", () => {
  for (const state of ["complete", "failed", "stopped", "cancelled"]) {
    for (const type of ["delta", "proposal", "done", "cancelled"]) {
      assert.equal(acceptsEvent({requestId: "request-old", state}, envelope("request-old", type)), false);
    }
  }
  assert.equal(acceptsEvent({requestId: "request-new", state: "running"}, envelope("request-old", "cancelled")), false);
});


test("history hydration rejects wrong projects and older revisions but accepts storage-only changes", () => {
  const current = {schemaVersion:1, projectId:"orbit", revision:7, conversations:[]};
  assert.equal(acceptsConversationSnapshot({...current, storage:{status:"saved"}}, current, "orbit"), true);
  assert.equal(acceptsConversationSnapshot({...current, revision:8}, current, "orbit"), true);
  assert.equal(acceptsConversationSnapshot({...current,schemaVersion:2},current,"orbit"),true);
  assert.equal(acceptsConversationSnapshot({...current,schemaVersion:3},current,"orbit"),true);
  assert.equal(acceptsConversationSnapshot({...current,schemaVersion:4},current,"orbit"),true);
  assert.equal(acceptsConversationSnapshot({...current,schemaVersion:5},current,"orbit"),true);
  assert.equal(acceptsConversationSnapshot({...current,schemaVersion:6},current,"orbit"),true);
  assert.equal(acceptsConversationSnapshot({...current,schemaVersion:7},current,"orbit"),true);
  assert.equal(acceptsConversationSnapshot({...current,schemaVersion:8},current,"orbit"),true);
  assert.equal(acceptsConversationSnapshot({...current,schemaVersion:9},current,"orbit"),true);
  assert.equal(acceptsConversationSnapshot({...current,schemaVersion:10},current,"orbit"),true);
  for (const record of [{...current, projectId:"other"}, {...current, revision:6}, {...current, revision:NaN}, {...current, schemaVersion:12}, {...current, conversations:null}]) {
    assert.equal(acceptsConversationSnapshot(record, current, "orbit"), false);
  }
});

test("saved verification remains historical and cannot borrow another proposal's result or imply live checks", () => {
  const record = {id:"run-1", proposalId:proposal.id, revision:"after-43", previewRevision:"preview-43", runtimeSession:"old-runtime", recordedAt:"2026-10-28T16:00:00.000Z", compilation:"passed", interaction:"passed", visual:"passed", observed:true, connected:true, historical:true};
  const history = verificationHistory(proposal, [{verificationHistory:[record, record, {...record,id:"foreign",proposalId:"other"}, {...record,id:"unverified",historical:false}]}]);
  assert.equal(history.length, 1);
  assert.equal(history[0].revision, "after-43");
  assert.equal(history[0].runtimeSession, "old-runtime");
  assert.equal(history[0].interaction, "not-run");
  assert.equal(history[0].visual, "not-run");
  assert.equal(history[0].historical, true);
  assert.equal(history[0].connected, undefined);
  assert.equal(verification(applied, undefined).compilation, "not-run", "history does not give the live preview credit");
});

const {normalizeIntent,planRevision,planValues,planDraftValid,planStepState}=sandbox.module.exports;
const plan={id:"plan",steps:[{id:"first",references:[saved]},{id:"wide",references:[saved,form]},{id:"empty",references:[]}]};
const revision={revision:0,title:"Plan",summary:"Improve saving",steps:plan.steps.map(step=>({id:step.id,title:"Step",detail:"Make the intended change",included:true})),risks:[],verification:["Check the result"]};
const planTurn={state:"complete",plan,planRevisions:[revision],context:[saved,form]};
test("four intent normalization preserves legacy Build without inventing an unsupported mode",()=>{
 for(const intent of ["ask","plan","build","review"])assert.equal(normalizeIntent(intent),intent);
 assert.equal(normalizeIntent("change"),"build");assert.equal(normalizeIntent("execute-everything"),"ask");
});
test("plan versions retain original step identities and validate UTF8 bounds",()=>{
 assert.equal(planRevision(planTurn),revision);assert.equal(planRevision(planTurn,9),null);
 assert.equal(planDraftValid(planValues(revision),plan),true);
 for(const patch of [{title:""},{title:"界".repeat(54)},{steps:[revision.steps[0],revision.steps[0],revision.steps[2]]},{steps:revision.steps.slice(0,2)},{risks:Array(13).fill("Risk")}])assert.equal(planDraftValid({...planValues(revision),...patch},plan),false);
 assert.equal(planDraftValid({...planValues(revision),steps:[...revision.steps].reverse()},plan),true);
});
test("plan handoff requires one referenced file, included step, and the complete fresh basis",()=>{
 assert.equal(planStepState(planTurn,"first",[saved,form]).canPrepare,true);
 for(const [step,files,dirty] of [["wide",[saved,form],[]],["empty",[saved,form],[]],["first",[saved],[]],["first",[saved,{...form,revision:"changed"}],[]],["first",[saved,form],[form.path]]])assert.equal(planStepState(planTurn,step,files,dirty).canPrepare,false);
 assert.equal(planStepState({...planTurn,state:"running"},"first",[saved,form]).canPrepare,false);
 assert.equal(planStepState({...planTurn,planRevisions:[{...revision,steps:revision.steps.map(step=>({...step,included:false}))}]},"first",[saved,form]).canPrepare,false);
});
test("plan-backed proposals include the full local basis in freshness and dirty guards",()=>{
 const backed={...proposal,context:[saved],planBasis:[saved,form]};
 assert.equal(proposalState(backed,[saved,form]).canApply,true);
 assert.equal(proposalState(backed,[saved,form],[form.path]).canApply,false);
 assert.equal(proposalState(backed,[saved,{...form,revision:"changed"}]).canApply,false);
 assert.equal(proposalState(backed,[saved]).evidence.status,"unknown");
});


test("unknown plan basis blocks Apply while Undo depends only on the applied target",()=>{
  const linked={...proposal,context:[saved],planBasis:[saved,form]};
  const missing=proposalState(linked,[saved]);assert.equal(missing.canApply,false);assert.match(missing.reason,/Check the original plan source/);
  const restored=proposalState(linked,[saved,form]);assert.equal(restored.canApply,true);
  const after={...linked,status:"applied",appliedRevision:applied.appliedRevision};
  assert.equal(proposalState(after,[appliedFile],[form.path]).canUndo,true,"closed or dirty original plan dependencies cannot prevent target-only Undo");
  assert.equal(proposalState(after,[appliedFile,form],[saved.path]).canUndo,false,"a draft in the actual applied target still blocks Undo");
  assert.equal(proposalState({...after,context:[saved,form]},[appliedFile],[form.path]).canUndo,true);
});


test("change groups require exact current host authority and keep recovery distinct from new edits",()=>{
 const {changeSetState}=sandbox.module.exports,group={id:"group-1",revision:0,status:"proposed",files:[{id:"a",path:saved.path},{id:"b",path:form.path}]};
 const session={current:group,busy:false,storage:{status:"saved"},assessment:{files:[{path:saved.path,state:"before",dirty:false},{path:form.path,state:"before",dirty:false}],canApply:true,canUndo:false,canRecover:false}};
 const ready={trusted:true,ownerReady:true,historyReady:true,running:false};
 assert.equal(changeSetState(group,session,ready).canApply,true);
 for(const extra of [{trusted:false},{running:true},{ownerReady:false},{historyReady:false}])assert.equal(changeSetState(group,session,{...ready,...extra}).canApply,false);
 for(const patch of [{current:{...group,revision:1}},{current:{...group,id:"other"}},{busy:true},{storage:{status:"error"}},{assessment:{...session.assessment,canApply:false}}])assert.equal(changeSetState(group,{...session,...patch},ready).canApply,false);
 for(const issue of [{state:"conflict"},{state:"unavailable"},{dirty:true}])assert.equal(changeSetState(group,{...session,assessment:{...session.assessment,files:[session.assessment.files[0],{...session.assessment.files[1],...issue}]}},ready).canApply,false);
 assert.equal(changeSetState(group,session,{...ready,ownerReady:false}).canDiscard,true,"a stopped owner can discard staged files without source writes");
 const recovery={...group,status:"recovery-required"},recovering={...session,current:recovery,assessment:{...session.assessment,canApply:false,canRecover:true}};
 const recovered=changeSetState(recovery,recovering,{...ready,ownerReady:false,historyReady:false});assert.equal(recovered.canRecover,true);assert.equal(recovered.canDiscard,false);assert.equal(recovered.canApply,false);
 assert.equal(changeSetState(recovery,{...recovering,assessment:{...recovering.assessment,canRecover:false}},ready).canRecover,false);
 assert.equal(changeSetState({...group,status:"applied"},{...session,current:{...group,status:"applied"},assessment:{...session.assessment,canUndo:true}},ready).canUndo,true);
});


test("change group actions respond to current drafts before host assessment refreshes",()=>{
 const {changeSetState}=sandbox.module.exports,dependency={path:"src/shared.ts",revision:"dep-1"},group={id:"group-2",revision:0,status:"proposed",files:[{id:"a",path:saved.path}],context:[saved,dependency]};
 const session={current:group,busy:false,storage:{status:"saved"},assessment:{files:[{path:saved.path,state:"before",dirty:false}],canApply:true,canUndo:true,canRecover:true}},ready={trusted:true,ownerReady:true,historyReady:true};
 for(const path of [saved.path,dependency.path])assert.equal(changeSetState(group,session,{...ready,dirtyPaths:[path]}).canApply,false);
 for(const status of ["applied","recovery-required"]){const checkpoint={...group,status},view=changeSetState(checkpoint,{...session,current:checkpoint},{...ready,dirtyPaths:[dependency.path]});assert.equal(status==="applied"?view.canUndo:view.canRecover,true);const blocked=changeSetState(checkpoint,{...session,current:checkpoint},{...ready,dirtyPaths:[saved.path]});assert.equal(status==="applied"?blocked.canUndo:blocked.canRecover,false);}
});


test("fresh target files cannot promote an unavailable supporting change-group basis",()=>{
 const {changeSetState}=sandbox.module.exports,group={id:"basis-group",revision:0,status:"proposed",files:[{id:"a",path:saved.path}],context:[saved,form]},session={current:group,storage:{status:"saved"},assessment:{files:[{path:saved.path,state:"before",dirty:false}],canApply:false,reason:"A supporting source is unavailable."}};
 const result=changeSetState(group,session,{trusted:true,ownerReady:true,historyReady:true});assert.equal(result.canApply,false);assert.equal(result.freshness,"Source needs review");assert.equal(result.reason,session.assessment.reason);
});


const executionGroup={id:"execution-group",revision:0,status:"proposed",files:[{path:saved.path},{path:form.path}],context:[saved,form]};
const executionReady={id:"execution-1",groupId:executionGroup.id,groupRevision:0,revision:2,status:"ready",tasks:[{id:"node:test",label:"Node tests",command:"node --test"}],output:""};
const executionSession={current:null,history:[],busy:false,storage:{status:"saved"},capabilities:{supported:true,network:"blocked",filesystem:"isolated-copy"},assessment:{canPrepare:true,canRun:true,canStop:false}};
const executionOptions={current:true,groupReady:true,trusted:true,ownerReady:true,historyReady:true,running:false};
test("isolated execution requires host capabilities, full group eligibility and exact prepared identity",()=>{
 const {executionState}=sandbox.module.exports;
 assert.equal(executionState(executionGroup,executionSession,executionOptions).canPrepare,true);
 assert.equal(executionState(executionGroup,{...executionSession,current:executionReady},executionOptions).canRun,true);
 for(const patch of [{current:false},{groupReady:false},{trusted:false},{ownerReady:false},{historyReady:false},{running:true}]){const state=executionState(executionGroup,{...executionSession,current:executionReady},{...executionOptions,...patch});assert.equal(state.canPrepare,false);assert.equal(state.canRun,false);}
 for(const patch of [{busy:true},{storage:{status:"error"}},{capabilities:{supported:true,network:"unavailable",filesystem:"isolated-copy"}},{assessment:{canPrepare:false,canRun:false}}]){const state=executionState(executionGroup,{...executionSession,current:executionReady,...patch},executionOptions);assert.equal(state.canPrepare,false);assert.equal(state.canRun,false);}
 for(const patch of [{groupId:"foreign"},{groupRevision:1},{status:"passed"},{tasks:[]}])assert.equal(executionState(executionGroup,{...executionSession,current:{...executionReady,...patch}},executionOptions).canRun,false);
});
test("Stop remains available for an active isolated run after its conversation becomes read-only",()=>{
 const {executionState}=sandbox.module.exports,session={...executionSession,busy:true,current:{...executionReady,status:"running"},assessment:{canPrepare:false,canRun:false,canStop:true}};
 for(const patch of [{ownerReady:false},{historyReady:false},{groupReady:false},{current:false},{running:true}])assert.equal(executionState(executionGroup,session,{...executionOptions,...patch}).canStop,true);
 assert.equal(executionState(executionGroup,session,{...executionOptions,trusted:false}).canStop,false);
 assert.equal(executionState({...executionGroup,id:"other"},session,executionOptions).canStop,false);
});
test("isolated process results retain their group and cannot imply live verification",()=>{
 const {executionState}=sandbox.module.exports,first={...executionReady,id:"first",status:"failed"},last={...executionReady,id:"last",status:"passed"};
 const state=executionState(executionGroup,{...executionSession,current:{...executionReady,groupId:"other"},history:[first,last,{...last,id:"foreign",groupId:"other"}]},{...executionOptions,current:false});
 assert.deepEqual(Array.from(state.records,record=>record.id),["first","last"]);assert.equal(state.latest.id,"last");assert.equal(state.historical,true);assert.equal(state.status,"Command passed");assert.equal(state.canRun,false);assert.equal(state.canPrepare,false);assert.equal(Object.hasOwn(state,"compilation"),false);
});
test("isolated storage retry does not enable execution or a source change",()=>{
 const {executionState,changeSetState}=sandbox.module.exports;
 const retry=executionState(executionGroup,{...executionSession,storage:{status:"unavailable",message:"Retained storage cannot be read."}},executionOptions);assert.equal(retry.canRetry,true);assert.equal(retry.canPrepare,false);assert.equal(retry.canRun,false);
 assert.equal(executionState(executionGroup,{...executionSession,busy:true,storage:{status:"error"}},executionOptions).canRetry,false);
 const groupSession={current:executionGroup,storage:{status:"saved"},assessment:{files:[{path:saved.path,state:"before"},{path:form.path,state:"before"}],canApply:true,canUndo:true,canRecover:true}};
 for(const status of ["proposed","applied","recovery-required"]){const group={...executionGroup,status},state=changeSetState(group,{...groupSession,current:group},{...executionOptions,executionBusy:true});assert.equal(state.canApply,false);assert.equal(state.canUndo,false);assert.equal(state.canRecover,false);assert.equal(state.canDiscard,false);assert.equal(state.canDiff,true);}
});


test('request revisions retain canonical parent, mode and complete source boundaries',()=>{
  const context=[{path:'a.ts',revision:'a'},{path:'b.ts',revision:'b'}],parent={requestId:'parent',state:'stopped',intent:'ask',context},conversation={id:'chat',turns:[parent]},descriptor={version:1,conversationId:'chat',requestId:'parent'},check=(changes={})=>sandbox.module.exports.requestRevisionState(changes.descriptor || descriptor,changes.conversation || conversation,changes.intent || 'ask',changes.paths || ['a.ts','b.ts'],changes.files || context,changes.dirty || []);
  assert.equal(check().valid,true);assert.equal(check().reason,'');
  for(const changes of [{descriptor:{...descriptor,conversationId:'other'}},{descriptor:{...descriptor,requestId:'other'}},{intent:'build'},{paths:['a.ts']},{paths:['b.ts','a.ts']},{paths:['a.ts','a.ts']},{conversation:{...conversation,turns:[{...parent,state:'running'}]}},{conversation:{...conversation,turns:[{...parent,planContext:{version:1}}]}},{conversation:{...conversation,turns:[{...parent,ephemeral:true}]}}])assert.equal(check(changes).valid,false);
  assert.match(check({files:[{path:'a.ts',revision:'new'},context[1]]}).reason,/Source changed/);assert.match(check({files:[context[0]]}).reason,/Load the original/);assert.match(check({dirty:['a.ts']}).reason,/Save the selected/);assert.match(check({conversation:{...conversation,archived:true}}).reason,/Restore this conversation/);
});


test('group refinement derives staged input without mutating the original saved basis',()=>{
 const a={path:'a.ts',revision:'a',source:'before a'},b={path:'b.ts',revision:'b',source:'support b'},group={id:'group',revision:0,status:'proposed',files:[{id:'file',path:a.path,baseRevision:a.revision,before:a.source,after:'after a'}],context:[a,b].map(({path,revision})=>({path,revision}))},parent={requestId:'parent',state:'complete',intent:'build',context:[a,b],changeSet:group},conversation={id:'chat',turns:[parent]},descriptor={version:1,conversationId:'chat',requestId:'parent',groupId:'group',groupRevision:0,groupDigest:'digest'},session={current:group,busy:false,storage:{status:'saved'},assessment:{canApply:true}};
 const shared=sandbox.module.exports.groupRevisionSources(descriptor,conversation);assert.equal(shared.valid,true);assert.equal(shared.files[0].origin,'staged');assert.equal(shared.files[0].source,'after a');assert.equal(shared.files[1].origin,'saved');assert.equal(parent.context[0].source,'before a');
 const check=(patch={})=>sandbox.module.exports.groupRevisionState(patch.descriptor || descriptor,conversation,patch.session || session,'build',patch.paths || ['a.ts','b.ts'],patch.files || [a,b],patch.dirty || []);
 assert.equal(check().reason,'');assert.equal(check({paths:['b.ts','a.ts']}).valid,false);assert.equal(check({descriptor:{...descriptor,groupRevision:1}}).valid,false);assert.match(check({dirty:['b.ts']}).reason,/Save/);assert.match(check({files:[{...a,revision:'changed'},b]}).reason,/changed/);assert.match(check({files:[a]}).reason,/Load/);assert.match(check({session:{...session,assessment:{canApply:false}}}).reason,/Check/);
 assert.equal(sandbox.module.exports.requestRevisionState({version:1,conversationId:'chat',requestId:'parent'},{...conversation,turns:[{...parent,groupRevision:descriptor}]},'build',['a.ts','b.ts'],[a,b]).valid,false);
});

test('restoring a group version needs retained identity, fresh shared basis and no competing work',()=>{
 const context=[{path:'a.ts',revision:'a'}],older={id:'old',revision:0,status:'proposed',context},current={...older,id:'new'},session={current,busy:false,storage:{status:'saved'},assessment:{canApply:true},versions:[{parentId:null,group:older},{parentId:older.id,group:current}]},options={trusted:true,ownerReady:true,historyReady:true},check=(state=session,extra={})=>sandbox.module.exports.groupVersionState(older,state,{...options,...extra});
 assert.equal(check().canRestore,true);for(const extra of [{running:true},{executionBusy:true},{ownerReady:false},{historyReady:false},{trusted:false},{dirtyPaths:['a.ts']}])assert.equal(check(session,extra).canRestore,false);
 for(const change of [{current:older},{current:{...current,status:'applied'}},{storage:{status:'error'}},{assessment:{canApply:false}},{versions:[]},{current:{...current,context:[{path:'other.ts',revision:'a'}]}}])assert.equal(check({...session,...change}).canRestore,false);
});


test('group version controls stay within one retained root chain',()=>{
 const a={id:'a',revision:0,status:'proposed',context:[]},b={...a,id:'b'},other={...a,id:'other'},versions=[{parentId:null,group:a},{parentId:'a',group:b},{parentId:null,group:other}],session={current:b,versions,busy:false,storage:{status:'saved'},assessment:{canApply:true}},options={trusted:true,ownerReady:true,historyReady:true};
 assert.deepEqual(Array.from(sandbox.module.exports.groupVersionChain(a,session),item=>item.group.id),['a','b']);assert.equal(sandbox.module.exports.groupVersionState(a,session,options).canRestore,true);assert.equal(sandbox.module.exports.groupVersionState(other,session,options).canRestore,false);assert.match(sandbox.module.exports.groupVersionState(other,session,options).reason,/current group/);
 assert.equal(sandbox.module.exports.groupVersionChain(a,{versions:[{parentId:'a',group:a}]}).length,0);
});

test("check plans distinguish Run, Retry, Skip, and End with exact execution evidence",()=>{
 const {checkPlanState,executionState}=sandbox.module.exports;
 const group={id:"group",revision:3,status:"proposed"},task={id:"node:test",label:"Node tests",command:"node --test"},step={id:"step",task,status:"pending",attempts:[]};
 const plan={id:"plan",groupId:"group",groupRevision:3,revision:2,status:"paused",steps:[step]},options={current:true,groupReady:true,trusted:true,ownerReady:true,historyReady:true,running:false};
 const session={current:{id:"ready",groupId:"group",groupRevision:3,status:"ready",tasks:[task]},storage:{status:"saved"},capabilities:{supported:true,network:"blocked",filesystem:"isolated-copy"},assessment:{canPrepare:true,canRun:true},planSession:{current:plan,history:[],storage:{status:"saved"},assessment:{canCreate:false,canRunNext:true,canSkipStep:true,canEnd:true,nextStepId:"step"}}};
 const view=checkPlanState(group,session,options);assert.equal(view.canRunNext,true);assert.equal(view.canSkipStep,true);assert.equal(view.canEnd,true);assert.equal(view.canCreate,false);assert.equal(executionState(group,session,options).canRun,false);assert.equal(executionState(group,session,options).canPrepare,false);
 const dirty=checkPlanState(group,session,{...options,groupReady:false});assert.equal(dirty.canRunNext,false);assert.equal(dirty.canSkipStep,true);assert.equal(dirty.canEnd,true);
 const old=checkPlanState({...group,revision:4},session,{...options,ownerReady:false});assert.equal(old.canRunNext,false);assert.equal(old.canSkipStep,false);assert.equal(old.canEnd,true);assert.equal(old.plan.id,"plan");
 const attempt={id:"attempt",status:"interrupted",executionId:"output"},retryPlan={...plan,steps:[{...step,attempts:[attempt]}]},retry={...session,planSession:{...session.planSession,current:retryPlan,assessment:{...session.planSession.assessment,canRetryStep:true,retryStepId:"step"}}};
 const retried=checkPlanState(group,retry,options);assert.equal(retried.canRunNext,false);assert.equal(retried.canRetryStep,true);
 const record={id:"output",groupId:"group",groupRevision:3,plan:{planId:"plan",stepId:"step",attemptId:"attempt"}};assert.equal(checkPlanState(group,{...retry,history:[record]},options).recordFor(retryPlan.steps[0],attempt).id,"output");assert.equal(checkPlanState(group,{...retry,history:[{...record,plan:{...record.plan,attemptId:"late"}}]},options).recordFor(retryPlan.steps[0],attempt),null);
 const live={...plan,status:"running",activeAttemptId:"attempt",steps:[{...step,attempts:[{...attempt,status:"running"}]}]},liveSession={...session,planSession:{...session.planSession,current:live,busy:true,assessment:{canStop:true}}};assert.equal(checkPlanState(group,liveSession,{...options,ownerReady:false}).canStop,true);assert.equal(checkPlanState(group,{...liveSession,planSession:{...liveSession.planSession,current:{...live,activeAttemptId:"stale"}}},options).canStop,false);
 const completed={...plan,status:"completed",steps:[{...step,status:"skipped"}]};assert.equal(checkPlanState(group,{...session,planSession:{...session.planSession,current:completed}},options).status,"0 passed · 1 skipped");
});


test("check-plan recovery uses actual process activity after a terminal outcome could not be saved",()=>{
 const {checkPlanState}=sandbox.module.exports,group={id:"group",revision:1,status:"proposed"};
 const attempt={id:"attempt",executionId:"run",status:"running"},plan={id:"plan",groupId:"group",groupRevision:1,revision:3,status:"running",activeAttemptId:"attempt",steps:[{id:"step",status:"pending",attempts:[attempt]}]};
 const execution={current:{id:"run",status:"passed"},busy:false,storage:{status:"error"},planSession:{current:plan,busy:false,storage:{status:"error"},assessment:{canRunNext:false,canSkipStep:false,canStop:false,canEnd:false}}};
 const view=checkPlanState(group,execution,{current:true,groupReady:true,trusted:true,ownerReady:true,historyReady:true});assert.equal(view.busy,false);assert.equal(view.status,"Awaiting saved outcome");assert.equal(view.canRetryStorage,true);assert.equal(view.canRunNext,false);assert.equal(view.canSkipStep,false);assert.equal(view.canStop,false);assert.equal(view.canEnd,false);
});


test("a pending check exposes executor capacity after higher-priority storage and ownership reasons",()=>{
 const {checkPlanState}=sandbox.module.exports,group={id:"group",revision:1,status:"proposed"},step={id:"step",status:"pending",attempts:[]},plan={id:"plan",groupId:"group",groupRevision:1,status:"paused",steps:[step]};
 const reason="Local execution history is full. Existing records are preserved.",execution={busy:false,storage:{status:"saved"},assessment:{canPrepare:false,reason},capabilities:{supported:true,network:"blocked",filesystem:"isolated-copy"},planSession:{current:plan,busy:false,storage:{status:"saved"},assessment:{canRunNext:false,canRetryStep:false,canSkipStep:true,canEnd:true,nextStepId:"step"}}},options={current:true,groupReady:true,trusted:true,ownerReady:true,historyReady:true};
 const view=checkPlanState(group,execution,options);assert.equal(view.reason,reason);assert.equal(view.canRunNext,false);assert.equal(view.canSkipStep,true);assert.equal(view.canEnd,true);
 assert.match(checkPlanState(group,execution,{...options,ownerReady:false}).reason,/active, completed conversation/);assert.match(checkPlanState(group,execution,{...options,groupReady:false}).reason,/source changed/);
 assert.equal(checkPlanState(group,{...execution,planSession:{...execution.planSession,storage:{status:"error",message:"Save the pending decision."}}},options).reason,"Save the pending decision.");assert.equal(checkPlanState(group,{...execution,planSession:{...execution.planSession,assessment:{...execution.planSession.assessment,reason:"Plan attempt limit reached."}}},options).reason,"Plan attempt limit reached.");
});


test("check suggestion context validates staged content, ordered saved basis and the whole prepared catalog",()=>{
 const {checkContextState}=sandbox.module.exports,source={id:"S1",path:"a.ts",revision:"a".repeat(64),source:"before",lines:1},group={id:"group",revision:0,status:"proposed",files:[{id:"file",path:source.path,baseRevision:source.revision,before:source.source,after:"staged"}]},parent={requestId:"build",state:"complete",context:[source],changeSet:group},conversation={id:"chat",turns:[parent]};
 const descriptor={version:1,conversationId:"chat",requestId:"build",groupId:"group",groupRevision:0,groupDigest:"d".repeat(64),snapshotRevision:"e".repeat(64),tasks:[{id:"node:test",label:"Node tests"}]},groups={current:group,storage:{status:"saved"},assessment:{canApply:true}},execution={current:{...descriptor,status:"ready",tasks:descriptor.tasks},storage:{status:"saved"}};
 const evaluate=(context=descriptor,exec=execution,changes=groups)=>checkContextState(context,conversation,changes,exec,"plan",[source.path],[source],[]);
 const view=evaluate();assert.equal(view.valid,true);assert.equal(view.reason,"");assert.equal(view.files[0].source,"staged");assert.equal(source.source,"before");
 assert.match(evaluate(descriptor,{...execution,current:{...execution.current,status:"interrupted"}}).reason,/Prepare workspace again/);assert.match(evaluate(descriptor,{...execution,current:{...execution.current,snapshotRevision:"f".repeat(64)}}).reason,/Prepare workspace again/);assert.match(evaluate(descriptor,{...execution,current:{...execution.current,tasks:[{id:"node:test",label:"Changed label"}]}}).reason,/Prepare workspace again/);
 assert.match(evaluate(descriptor,execution,{...groups,current:{...group,files:[{...group.files[0],after:"other"}]}}).reason,/staged group changed/);assert.equal(checkContextState(descriptor,conversation,groups,execution,"build",[source.path],[source],[]).valid,false);assert.equal(checkContextState(descriptor,conversation,groups,execution,"plan",["different.ts"],[source],[]).valid,false);assert.match(checkContextState(descriptor,conversation,groups,execution,"plan",[source.path],[source],[source.path]).reason,/Save the selected files/);
});

test("AI check acceptance derives from exact saved plan provenance and preserves zero-check advice",()=>{
 const {checkSuggestionState}=sandbox.module.exports,source={id:"S1",path:"a.ts",revision:"a".repeat(64),source:"before",lines:1},group={id:"group",revision:0,status:"proposed",files:[{id:"file",path:source.path,baseRevision:source.revision,before:source.source,after:"staged"}]},parent={requestId:"build",state:"complete",context:[source],changeSet:group};
 const context={version:1,conversationId:"chat",requestId:"build",groupId:"group",groupRevision:0,groupDigest:"d".repeat(64),snapshotRevision:"e".repeat(64),tasks:[{id:"node:test",label:"Node tests"}]},artifact={id:"suggestion",projectId:"project",checks:[],limitations:["No visual check supported."]},turn={requestId:"request",intent:"plan",state:"complete",context:[source],checkContext:context,checkSuggestion:artifact},conversation={id:"chat",turns:[parent,turn]},groups={current:group,storage:{status:"saved"},assessment:{canApply:true}},execution={current:{...context,status:"ready",tasks:context.tasks},storage:{status:"saved"},planSession:{current:null,history:[],storage:{status:"saved"},assessment:{canCreate:true}}},options={trusted:true,currentConversation:true,historyReady:true};
 const evaluate=(value=turn,exec=execution,extra={})=>checkSuggestionState(value,conversation,groups,exec,[source],[],{...options,...extra});
 assert.equal(evaluate().canSave,false);assert.equal(evaluate().canDismiss,true);assert.equal(evaluate(turn,execution,{taskIds:["node:test"]}).canSave,true);assert.equal(evaluate(turn,execution,{taskIds:["shell"]}).canSave,false);assert.equal(evaluate({...turn,checkDismissed:true},execution,{taskIds:["node:test"]}).canSave,false);assert.equal(evaluate({...turn,completedWhileStopping:true},execution,{taskIds:["node:test"]}).canSave,false);
 const plan={id:"plan",projectId:"project",groupId:"group",groupRevision:0,groupDigest:context.groupDigest,snapshotRevision:context.snapshotRevision,steps:[{task:context.tasks[0]}],recommendation:{conversationId:"chat",requestId:"request",artifactId:"suggestion",artifactDigest:"f".repeat(64)}};
 const adopted={...execution,planSession:{...execution.planSession,history:[plan]}};assert.equal(evaluate(turn,adopted).status,"Check plan saved");assert.equal(evaluate(turn,adopted).canSave,false);assert.equal(evaluate(turn,adopted).canOpen,true);assert.equal(evaluate(turn,{...adopted,planSession:{...adopted.planSession,history:[{...plan,snapshotRevision:"0".repeat(64)}]}}).accepted,null);
});

const investigationRef={path:'src/ProfilePanel.tsx',revision:'a'.repeat(16),line:1,column:1};
const investigationFixture={version:1,id:'c7fa4054-bbb0-4022-b094-1be315c31744',projectId:'project',featureId:'profile',featureRevision:2,anchor:{path:investigationRef.path,revision:investigationRef.revision},basisDigest:'b'.repeat(64),createdAt:'2026-10-29T12:00:00.000Z',digest:'c'.repeat(64),edges:[{id:'relationship-'+ '1'.repeat(16),kind:'call',from:investigationRef,to:{...investigationRef,path:'src/api/profile.ts',revision:'d'.repeat(16)},provenance:'source'}],requests:[],boundaries:[{kind:'unsupported',detail:'Static saved-source relationships do not establish runtime behavior.'}],counts:{edges:1,requests:0},truncated:false};
const investigationBinding={id:investigationFixture.id,digest:investigationFixture.digest,status:'ready',dirtyPaths:[]};
const investigationOptions={projectId:'project',featureId:'profile',featureRevision:2,intent:'ask',paths:[investigationRef.path],files:[{...investigationFixture.anchor,source:'saved source'}],dirtyPaths:['src/UnrelatedDraft.ts'],refreshed:true,historyReady:true};
const investigationState=patch=>sandbox.module.exports.sourceInvestigationState(investigationFixture,investigationBinding,{...investigationOptions,...patch});

test('source investigation presentation validates bounded source evidence and hides arbitrary metadata',()=>{
 const parse=sandbox.module.exports.sourceInvestigationSnapshot;
 assert.ok(parse(investigationFixture));
 for(const value of [
  {...investigationFixture,rawCommand:'run this'},
  {...investigationFixture,anchor:{...investigationFixture.anchor,path:'../outside.ts'}},
  {...investigationFixture,edges:[{...investigationFixture.edges[0],to:{...investigationRef,revision:'e'.repeat(16)}}]},
  {...investigationFixture,edges:Array.from({length:25},()=>investigationFixture.edges[0])},
  {...investigationFixture,counts:{edges:2,requests:0}},
  {...investigationFixture,boundaries:[]},
  {...investigationFixture,requests:[{id:'request-'+ '2'.repeat(16),source:investigationRef,method:'GET',url:'/api?secret=value',urlKind:'literal',provenance:'source'}],counts:{edges:1,requests:1}},
 ])assert.equal(parse(value),null);
 assert.ok(parse({...investigationFixture,counts:{edges:2,requests:0},truncated:true}));
});
test('source investigation requires explicit current-view preparation despite a matching restored host identity',()=>{
 assert.equal(investigationState().canSend,true);
 assert.match(investigationState({refreshed:false}).reason,/Refresh investigation/);
 assert.match(sandbox.module.exports.sourceInvestigationState(investigationFixture,null,investigationOptions).reason,/Refresh investigation/);
 assert.match(sandbox.module.exports.sourceInvestigationState(investigationFixture,{...investigationBinding,digest:'f'.repeat(64)},investigationOptions).reason,/Refresh investigation/);
});
test('only displayed source references and the selected anchor affect dirty investigation sharing',()=>{
 assert.equal(investigationState().canSend,true);
 assert.match(investigationState({dirtyPaths:['src/api/profile.ts']}).reason,/Save the affected source files/);
 assert.match(investigationState({dirtyPaths:[investigationRef.path]}).reason,/Save the affected source files/);
 assert.equal(investigationState({dirtyPaths:['src/AnotherDraft.ts']}).canSend,true);
});
test('investigation ownership, sole-source selection, manifest status and source revision remain explicit gates',()=>{
 for(const patch of [{projectId:'other'},{featureId:'other'},{intent:'build'},{paths:[]},{paths:[investigationRef.path,'src/api/profile.ts']}])assert.equal(investigationState(patch).valid,false);
 assert.match(investigationState({featureRevision:3}).reason,/feature changed/);
 assert.match(investigationState({files:[]}).reason,/Load the saved anchor/);
 assert.match(investigationState({files:[{...investigationFixture.anchor,revision:'f'.repeat(16)}]}).reason,/Anchor source changed/);
 assert.match(sandbox.module.exports.sourceInvestigationState(investigationFixture,{...investigationBinding,status:'stale',message:'Saved project manifest changed.'},investigationOptions).reason,/Saved project manifest changed/);
 assert.equal(investigationState({historyReady:false}).canSend,false);
 assert.equal(investigationState({archived:true}).canSend,false);
});
test('schema-seven investigation history is accepted without enabling generic request revision',()=>{
 assert.equal(acceptsConversationSnapshot({schemaVersion:7,projectId:'project',revision:1,conversations:[]},null,'project'),true);
 const parent={requestId:'parent',intent:'ask',state:'complete',context:investigationOptions.files,sourceInvestigation:investigationFixture};
 assert.equal(sandbox.module.exports.requestRevisionState({version:1,conversationId:'chat',requestId:'parent'},{id:'chat',turns:[parent]},'ask',investigationOptions.paths,investigationOptions.files,[]).valid,false);
});

// The renderer reconstructs canonical saved decisions but the host remains authoritative.
const continuationFixture=await import('../../tests/investigation-continuation-fixture.mjs');
const continuationBackend=await import('../../../server/project/investigation-continuation.mjs');
const plain=value=>JSON.parse(JSON.stringify(value));
const continuationOptions={projectId:continuationFixture.project.id,featureId:continuationFixture.feature.id,featureRevision:continuationFixture.features.revision,intent:'plan',paths:[continuationFixture.a.path],files:continuationFixture.files,dirtyPaths:[continuationFixture.draft.path],refreshed:true,historyReady:true,running:false};
const continuationView=(value=continuationFixture.context1,chat=continuationFixture.conversation,patch={},binding=continuationFixture.binding(value))=>sandbox.module.exports.investigationContinuationState(value,chat,binding,{...continuationOptions,...patch});
test('continuation basis and chain state match canonical backend across each explicit checkpoint',()=>{
 const f=continuationFixture;
 for(const chat of [f.conversation,f.withFirst,f.withResult,f.withSecondResult,f.finished]){
  const expected=continuationBackend.deriveInvestigationChain(chat,f.seedTurn.requestId),actual=sandbox.module.exports.investigationChain(chat,f.seedTurn.requestId);assert.equal(actual.valid,true);for(const key of Object.keys(expected))assert.deepEqual(plain(actual[key]),plain(expected[key]),key);
  if(expected.canContinue){const value=continuationBackend.deriveInvestigationContext(chat,expected.latestRequestId),{digest,...basis}=value;assert.deepEqual(plain(sandbox.module.exports.investigationContextBasis(chat,expected.latestRequestId)),basis);assert.deepEqual(plain(sandbox.module.exports.investigationContextSnapshot(value)),value);}
 }
});
test('failed model and local attempts consume limits; retry uses stable explanation and restart stays paused',()=>{
 const f=continuationFixture;
 for(const status of ['failed','stopped','interrupted']){
  const failed={...f.first,state:status,answer:'PARTIAL NEVER SHARED',investigationDecision:undefined},chat={...f.conversation,turns:[f.seedTurn,failed]},expected=continuationBackend.deriveInvestigationContext(chat,failed.requestId),basis=sandbox.module.exports.investigationContextBasis(chat,failed.requestId);assert.deepEqual(plain(basis.previousExplanation),expected.previousExplanation);assert.equal(basis.budget.modelStep,2);assert.equal(basis.previousExplanation.text,f.seedTurn.answer);assert.ok(!JSON.stringify(basis).includes(failed.answer));
  const local={...f.first,investigationAttempts:[{id:'local-one',status,startedAt:'2026-10-29T12:00:00Z'}]},localChat={...f.conversation,turns:[f.seedTurn,local]},view=sandbox.module.exports.investigationChain(localChat,f.seedTurn.requestId);assert.equal(view.canRetryTool,true);assert.equal(view.canRun,false);assert.equal(view.canContinue,false);assert.equal(view.toolUsed,1);
  local.investigationAttempts.push({id:'local-two',status,startedAt:'2026-10-29T12:01:00Z'});const exhausted=sandbox.module.exports.investigationChain(localChat,f.seedTurn.requestId);assert.equal(exhausted.canRetryTool,false);assert.equal(exhausted.canContinue,false);assert.equal(exhausted.canEnd,true);assert.equal(exhausted.toolUsed,2);
 }
});
test('continuation sharing requires explicit refresh, exact chain, sole anchor and original owner',()=>{
 assert.equal(continuationView().canSend,true);assert.match(continuationView(undefined,undefined,{refreshed:false}).reason,/Refresh checkpoint/);assert.equal(continuationView(undefined,undefined,{},continuationFixture.binding(null)).canSend,false);
 for(const patch of [{intent:'ask'},{projectId:'other'},{featureId:'other'},{paths:[]},{paths:[continuationFixture.a.path,continuationFixture.b.path]}])assert.equal(continuationView(undefined,undefined,patch).valid,false);
 for(const patch of [{historyReady:false},{running:true},{featureRevision:8},{dirtyPaths:[continuationFixture.b.path]},{files:[]},{files:[{...continuationFixture.a,revision:'f'.repeat(16)}]}])assert.equal(continuationView(undefined,undefined,patch).canSend,false);
 assert.equal(continuationView(undefined,undefined,{dirtyPaths:[continuationFixture.draft.path]}).canSend,true);assert.equal(continuationView(continuationFixture.context1,continuationFixture.withFirst).valid,false);assert.equal(continuationView(undefined,undefined,{}, {...continuationFixture.binding(continuationFixture.context1),status:'stale',message:'Saved manifest changed'}).reason,'Saved manifest changed');
});
test('continuation snapshots reject malformed targets and budget claims, and generic request revision stays unavailable',()=>{
 const f=continuationFixture,parse=sandbox.module.exports.investigationContextSnapshot;assert.ok(parse(f.context1));
 for(const patch of [{version:2},{unexpected:true},{targets:[{...f.context1.targets[0],path:'../outside.ts'}]},{targets:[{...f.context1.targets[0],evidenceIds:['I2']}]},{budget:{...f.context1.budget,modelStep:3}},{previousExplanation:{...f.context1.previousExplanation,kind:'tool'}}])assert.equal(parse({...f.context1,...patch}),null);
 assert.equal(sandbox.module.exports.investigationDecisionValid(f.decision1,f.context1),true);assert.equal(sandbox.module.exports.investigationDecisionValid({...f.decision1,decision:{...f.decision1.decision,target:{...f.decision1.decision.target,path:f.c.path}}},f.context1),false);assert.equal(sandbox.module.exports.requestRevisionState({version:1,conversationId:f.conversation.id,requestId:f.first.requestId},f.withFirst,'plan',[f.a.path],f.files,[]).valid,false);
 assert.equal(sandbox.module.exports.investigationChain({...f.conversation,turns:[f.seedTurn,{...f.first,investigationContext:{...f.context1,parentRequestId:'foreign'}}]},f.seedTurn.requestId).valid,false);
});

const partialFixture=await import('../../tests/partial-acceptance-fixture.mjs');
const partialOptions={trusted:true,running:false,ownerReady:true,historyReady:true,dirtyPaths:[],executionBusy:false};
const partialView=(session,options={})=>sandbox.module.exports.changeSetState(session.current,session,{...partialOptions,...options});
test('acceptance units preserve the exact whole-file partition and saved selected/applied distinction',()=>{
 const f=partialFixture,s=f.session({revision:1,acceptance:f.acceptance([f.linked.id])}),v=partialView(s);assert.equal(v.acceptance.valid,true);assert.deepEqual(plain(v.acceptance.selectedPaths),[f.a.path,f.b.path]);assert.equal(v.acceptance.fullSelection,false);assert.equal(v.canApply,true);assert.equal(v.acceptance.canSelect,true);assert.equal(v.acceptance.canClear,true);assert.equal(v.acceptance.canPrepare,false);
 const noPlan=partialView(f.session());assert.equal(noPlan.acceptance.canPrepare,true);assert.equal(noPlan.acceptance.fullSelection,true);assert.equal(noPlan.canApply,true);
 const empty=partialView(f.session({revision:2,acceptance:f.acceptance([])}));assert.equal(empty.canApply,false);assert.equal(empty.acceptance.canSelect,true);assert.match(empty.acceptance.reason,/Choose at least one/);assert.equal(empty.freshness,'Selection required');
});
test('partial Undo and recovery only guard their accepted or interrupted target paths',()=>{
 const f=partialFixture,s=f.session({revision:3,status:'partially-applied',acceptance:f.acceptance([],[f.linked.id]),assessment:{canUndo:true,canApply:false,files:[{path:f.a.path,state:'after',dirty:false},{path:f.b.path,state:'after',dirty:false},{path:f.c.path,state:'conflict',dirty:true}]}});assert.equal(partialView(s,{dirtyPaths:[f.c.path]}).canUndo,true);assert.equal(partialView(s,{dirtyPaths:[f.a.path]}).canUndo,false);assert.equal(partialView(s).canApply,false);assert.equal(partialView(s).acceptance.canClear,false);
 const recovery={...s,current:{...s.current,status:'recovery-required'},assessment:{...s.assessment,canRecover:true,operationPaths:[f.a.path]}};assert.equal(partialView(recovery,{dirtyPaths:[f.c.path]}).canRecover,true);assert.equal(partialView(recovery,{dirtyPaths:[f.a.path]}).canRecover,false);
});
test('malformed or absent partial acceptance cannot authorize Apply Undo or recovery',()=>{
 const f=partialFixture;
 for(const invalid of [{...f.acceptance(),selectedUnitIds:['foreign']},{...f.acceptance(),appliedUnitIds:[f.linked.id]},{...f.acceptance(),plan:{...f.plan,units:[{...f.linked,paths:[f.a.path]}]}}])for(const status of ['proposed','partially-applied','recovery-required']){const s=f.session({status,acceptance:invalid,assessment:{canApply:true,canUndo:true,canRecover:true,operationPaths:[f.a.path]}}),view=partialView(s);assert.equal(view.acceptance.valid,false);assert.equal(view.canApply,false);assert.equal(view.canUndo,false);assert.equal(view.canRecover,false);assert.equal(view.acceptance.canSelect,false);assert.equal(view.acceptance.canClear,false);}
 const missing=partialView(f.session({status:'partially-applied',assessment:{canApply:true,canUndo:true}}));assert.equal(missing.canApply,false);assert.equal(missing.canUndo,false);
});
test('clearing selection remains explicitly host-authorized but independent of source freshness',()=>{
 const f=partialFixture,s=f.session({revision:2,acceptance:f.acceptance([]),assessment:{canApply:false,canClearAcceptance:true}});assert.equal(partialView(s,{dirtyPaths:[f.a.path]}).acceptance.canClear,true);for(const assessment of [undefined,{...s.assessment,canClearAcceptance:undefined},{...s.assessment,canClearAcceptance:false}])assert.equal(partialView({...s,assessment}).acceptance.canClear,false);
 for(const options of [{trusted:false},{ownerReady:false},{historyReady:false},{running:true},{executionBusy:true}])assert.equal(partialView(s,options).acceptance.canClear,false);assert.equal(partialView({...s,busy:true}).acceptance.canSelect,false);assert.equal(partialView({...s,storage:{status:'error'}}).acceptance.canSelect,false);
});
test('historical acceptance remains inspectable and cannot borrow current mutating eligibility',()=>{
 const f=partialFixture,old=f.session({revision:3,status:'partially-applied',acceptance:f.acceptance([],[f.linked.id])}),current={...old,current:{...f.group,id:'another',revision:0},acceptance:null};const historical=sandbox.module.exports.changeSetState(old.current,current,partialOptions);assert.equal(historical.acceptance.valid,true);assert.deepEqual(plain(historical.acceptance.appliedPaths),[f.a.path,f.b.path]);assert.equal(historical.acceptance.canSelect,false);assert.equal(historical.canApply,false);assert.equal(historical.canUndo,false);
});
