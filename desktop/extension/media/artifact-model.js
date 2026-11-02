/* Host evidence mapped into presentation state. This module never authorizes writes. */
(() => {
  "use strict";
  function freshness(context = [], files = [], dirtyPaths = []) {
    const changed = context.filter(source => files.some(file => file.path === source.path && file.revision !== source.revision));
    const missing = context.filter(source => !files.some(file => file.path === source.path));
    const drafts = context.filter(source => dirtyPaths.includes(source.path));
    return { status: changed.length ? "stale" : missing.length || !context.length ? "unknown" : "current", changed, missing, drafts };
  }
  function proposalState(proposal, files = [], dirtyPaths = [], running = false, currentId = proposal?.id) {
    if (!proposal) return null;
    const context = [{path:proposal.path, revision:proposal.baseRevision}, ...(proposal.context || []).filter(file => file.path !== proposal.path), ...(proposal.status==="proposed" ? proposal.planBasis || [] : []).filter(file=>file.path!==proposal.path)];
    const evidence = freshness(context, files, dirtyPaths);
    const current = files.find(file => file.path === proposal.path);
    const dirty = dirtyPaths.includes(proposal.path) || proposal.status!=="applied" && context.some(file => dirtyPaths.includes(file.path));
    const basisUnknown=proposal.status==="proposed" && Boolean(proposal.planBasis?.length) && evidence.status==="unknown";
    const superseded = currentId !== proposal.id;
    const stale = proposal.status === "stale" || (proposal.status === "proposed" && evidence.status === "stale");
    const conflict = Boolean(proposal.conflict) || (proposal.status === "applied" && current && current.revision !== proposal.appliedRevision);
    const reason = superseded ? "This saved proposal is read-only."
      : dirty ? "Save or discard the editor draft before applying or undoing."
      : stale ? "Source changed. Create a new proposal."
      : basisUnknown ? "Check the original plan source before applying. Some source is unavailable in this view."
      : conflict ? "Source changed after Apply. Undo is unavailable to protect those edits."
      : proposal.reason || "";
    return {status:superseded ? "Previous proposal" : stale ? "Stale" : ({proposed:"Proposed",applied:"Applied",undone:"Undone",discarded:"Discarded"}[proposal.status] || "Unavailable"),
      evidence, dirty, stale, superseded, conflict, reason,
      canApply: proposal.status === "proposed" && !running && !dirty && !stale && !basisUnknown && !superseded && !proposal.reason,
      canUndo: proposal.status === "applied" && !running && !dirty && !conflict && !superseded && !proposal.reason};
  }
  function verification(proposal, design) {
    const included = proposal?.status === "applied" && design?.files?.some(file => file.path === proposal.path && file.revision === proposal.appliedRevision);
    const current = Boolean(included && !design?.stale);
    const compilation = current && ["passed","failed"].includes(design?.compilation) ? design.compilation : "not-run";
    return {compilation, interaction:"not-run", visual:"not-run", connected:current && design?.observed === true,
      revision:current ? design.revision : null,
      detail:current ? "Preview compilation covers this applied revision. It is not a full build or type check."
        : "No preview compilation is attached to this proposal’s applied revision."};
  }
  function acceptsEvent(turn, message) {
    return Boolean(turn && message?.type === "ai" && typeof message.requestId === "string" && message.requestId === turn.requestId
      && ["running","stopping"].includes(turn.state)
      && (turn.state !== "stopping" || ["cancelled", "done", "error"].includes(message.event?.type)));
  }
  function sourceInvestigationSnapshot(value) {
    const text=(value,max)=>typeof value==="string" && value.length<=max && !/[\u0000-\u001f\u007f]/.test(value);
    const path=value=>text(value,1000) && value.length>0 && !/^[\/\\]/.test(value) && !value.includes("\\") && !value.split("/").some(part=>!part || part==="." || part==="..");
    const exact=(value,required,optional=[])=>value && typeof value==="object" && !Array.isArray(value) && required.every(key=>Object.hasOwn(value,key)) && Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
    const hash=value=>typeof value==="string" && /^[a-f0-9]{64}$/.test(value),revision=value=>typeof value==="string" && /^[a-f0-9]{16}$/.test(value);
    const integer=(value,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(value) && value>=0 && value<=max;
    const ref=value=>exact(value,["path","revision","line","column"],["label"]) && path(value.path) && revision(value.revision) && integer(value.line,1000000) && value.line>0 && integer(value.column,1000000) && value.column>0 && (value.label===undefined || text(value.label,720));
    if(!exact(value,["version","id","projectId","featureId","featureRevision","anchor","basisDigest","createdAt","digest","edges","requests","boundaries","counts","truncated"]) || value.version!==1 || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.id || "") || ![value.projectId,value.featureId].every(item=>text(item,200) && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(item)) || !integer(value.featureRevision) || !exact(value.anchor,["path","revision"]) || !path(value.anchor.path) || !revision(value.anchor.revision) || !hash(value.basisDigest) || !hash(value.digest) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.createdAt || "") || !Number.isFinite(Date.parse(value.createdAt)) || typeof value.truncated!=="boolean")return null;
    if(!Array.isArray(value.edges) || value.edges.length>24 || !Array.isArray(value.requests) || value.requests.length>8 || !Array.isArray(value.boundaries) || value.boundaries.length>12 || !exact(value.counts,["edges","requests"]) || !integer(value.counts.edges,200) || !integer(value.counts.requests,100) || value.counts.edges<value.edges.length || value.counts.requests<value.requests.length || !value.truncated && (value.counts.edges!==value.edges.length || value.counts.requests!==value.requests.length))return null;
    if(value.edges.some(item=>!exact(item,["id","kind","from","to","provenance"],["detail"]) || !/^relationship-[a-f0-9]{16}$/.test(item.id || "") || !["import","re-export","stylesheet","call","render","type-reference","test-reference"].includes(item.kind) || item.provenance!=="source" || !ref(item.from) || !ref(item.to) || item.from.path!==value.anchor.path && item.to.path!==value.anchor.path || item.detail!==undefined && !text(item.detail,2048)))return null;
    if(value.requests.some(item=>!exact(item,["id","source","method","url","urlKind","provenance"]) || !/^request-[a-f0-9]{16}$/.test(item.id || "") || item.provenance!=="source" || !ref(item.source) || item.source.path!==value.anchor.path || !["dynamic","literal"].includes(item.urlKind) || item.method!==null && !/^[A-Z]{1,16}$/.test(item.method || "") || item.url!==null && (!text(item.url,4096) || /[\\?#]/.test(item.url)) || item.urlKind==="dynamic" && item.url!==null))return null;
    if(value.boundaries.some(item=>!exact(item,["kind","detail"]) || !["unsupported","limit","unavailable","parse-error","unresolved"].includes(item.kind) || !text(item.detail,2048) || !item.detail.trim()) || !value.boundaries.some(item=>item.kind==="unsupported") || new Set([...value.edges,...value.requests].map(item=>item.id)).size!==value.edges.length+value.requests.length || new TextEncoder().encode(JSON.stringify(value)).length>32768)return null;
    const revisions=new Map([[value.anchor.path,value.anchor.revision]]);
    for(const reference of [...value.edges.flatMap(item=>[item.from,item.to]),...value.requests.map(item=>item.source)]){if(revisions.has(reference.path) && revisions.get(reference.path)!==reference.revision)return null;revisions.set(reference.path,reference.revision);}
    return JSON.parse(JSON.stringify(value));
  }
  function sourceInvestigationState(snapshot,binding,options={}) {
    const result=sourceInvestigationSnapshot(snapshot),paths=options.paths || [],references=result?[result.anchor,...result.edges.flatMap(edge=>[edge.from,edge.to]),...result.requests.map(request=>request.source)]:[];
    const dirty=references.some(ref=>(options.dirtyPaths || []).includes(ref.path)) || Boolean(binding?.dirtyPaths?.length);
    const anchor=result && (options.files || []).find(file=>file.path===result.anchor.path);
    const valid=Boolean(result && result.projectId===options.projectId && result.featureId===options.featureId && options.intent==="ask" && paths.length===1 && paths[0]===result.anchor.path);
    const matched=Boolean(result && binding?.id===result.id && binding.digest===result.digest);
    const reason=!valid?"This investigation no longer matches the request. Remove it and prepare current relationships."
      :options.archived?"Restore this conversation before sharing an investigation."
      :options.historyReady===false?"Save conversation history before sharing this investigation."
      :options.running?"Wait for the current response to finish."
      :dirty?"Save the affected source files before sharing this investigation. Unsaved edits are excluded."
      :!options.refreshed || !matched?"Refresh investigation before sending. Saved evidence is not reanalyzed automatically."
      :result.featureRevision!==options.featureRevision?"The feature changed. Refresh investigation before sending."
      :binding.status!=="ready"?binding.message || "Source changed. Refresh investigation before sending."
      :!anchor?"Load the saved anchor source before sharing this investigation."
      :anchor.revision!==result.anchor.revision?"Anchor source changed. Refresh investigation before sending."
      :"";
    return {valid,matched,result,dirty,reason,canSend:!reason};
  }
  function investigationContextSnapshot(value) {
    const exact=(object,keys)=>object && typeof object==="object" && !Array.isArray(object) && Object.keys(object).length===keys.length && keys.every(key=>Object.hasOwn(object,key));
    const text=(value,max)=>typeof value==="string" && value.trim().length>0 && !value.includes("\0") && new TextEncoder().encode(value).length<=max;
    const token=value=>typeof value==="string" && value.length<=200 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
    if(!exact(value,["version","conversationId","rootRequestId","parentRequestId","result","goal","previousExplanation","targets","budget","digest"]) || value.version!==1 || ![value.conversationId,value.rootRequestId,value.parentRequestId].every(token) || !text(value.goal,24000) || !/^[a-f0-9]{64}$/.test(value.digest || ""))return null;
    const result=sourceInvestigationSnapshot(value.result),previous=value.previousExplanation,budget=value.budget;
    if(!result || !exact(previous,["requestId","kind","text"]) || !token(previous.requestId) || !["answer","decision"].includes(previous.kind) || !text(previous.text,65536) || !exact(budget,["modelStep","modelLimit","toolsUsed","toolLimit"]) || !Number.isInteger(budget.modelStep) || budget.modelStep<1 || budget.modelStep>3 || budget.modelLimit!==3 || !Number.isInteger(budget.toolsUsed) || budget.toolsUsed<0 || budget.toolsUsed>2 || budget.toolLimit!==2 || !Array.isArray(value.targets) || value.targets.length>24 || (budget.modelStep===3 || budget.toolsUsed===2) && value.targets.length)return null;
    if(value.targets.some((target,index)=>!exact(target,["id","path","revision","evidenceIds"]) || target.id!==`T${index+1}` || target.path===result.anchor.path || typeof target.path!=="string" || !/\.(?:tsx?|jsx?|mjs|cjs)$/i.test(target.path) || !/^[a-f0-9]{16}$/.test(target.revision || "") || !Array.isArray(target.evidenceIds) || !target.evidenceIds.length || target.evidenceIds.length>24 || new Set(target.evidenceIds).size!==target.evidenceIds.length || target.evidenceIds.some(id=>{if(!/^I(?:[1-9]|[12]\d|3[0-2])$/.test(id))return true;const edge=result.edges[Number(id.slice(1))-1];return !edge || ![edge.from,edge.to].some(ref=>ref.path===target.path && ref.revision===target.revision);})))return null;
    if(new Set(value.targets.map(target=>target.path)).size!==value.targets.length || new TextEncoder().encode(JSON.stringify(value)).length>131072)return null;
    return JSON.parse(JSON.stringify(value));
  }
  function investigationDecisionValid(decision,context) {
    if(!decision || decision.schemaVersion!==1 || !/^[a-f0-9-]{36}$/.test(decision.id || "") || decision.projectId!==context?.result?.projectId || decision.verificationStatus!=="not-run" || typeof decision.title!=="string" || !decision.title.trim() || decision.title.length>160 || typeof decision.summary!=="string" || !decision.summary.trim() || decision.summary.length>2000 || !Array.isArray(decision.limitations) || decision.limitations.length>12 || decision.limitations.some(item=>typeof item!=="string" || !item.trim() || item.length>500))return false;
    if(decision.decision?.kind==="finish")return typeof decision.decision.conclusion==="string" && Boolean(decision.decision.conclusion.trim()) && decision.decision.conclusion.length<=4000;
    return decision.decision?.kind==="investigate" && typeof decision.decision.reason==="string" && Boolean(decision.decision.reason.trim()) && decision.decision.reason.length<=2000 && context.targets.some(target=>JSON.stringify(target)===JSON.stringify(decision.decision.target));
  }
  function investigationChain(conversation,rootRequestId) {
    const unavailable={valid:false,rootRequestId,reason:"This saved investigation chain is unavailable.",canContinue:false,canRun:false,canRetryTool:false,canEnd:false};
    const root=conversation?.turns?.find(turn=>turn.requestId===rootRequestId);
    if(!root || root.intent!=="ask" || root.state!=="complete" || root.completedWhileStopping || root.ephemeral || root.investigationContext || !sourceInvestigationSnapshot(root.sourceInvestigation))return unavailable;
    const turns=conversation.turns.filter(turn=>turn.investigationContext?.rootRequestId===rootRequestId);let prior=rootRequestId,position=conversation.turns.indexOf(root),toolUsed=0;
    if(turns.length>3)return unavailable;
    for(const turn of turns){if(conversation.turns.indexOf(turn)<=position || turn.investigationContext.conversationId!==conversation.id || turn.investigationContext.parentRequestId!==prior || !investigationContextSnapshot(turn.investigationContext) || !Array.isArray(turn.investigationAttempts || []) || (turn.investigationAttempts || []).length>2)return unavailable;position=conversation.turns.indexOf(turn);prior=turn.requestId;toolUsed+=(turn.investigationAttempts || []).length;}
    if(toolUsed>2)return unavailable;
    const latest=turns.at(-1) || root,modelUsed=turns.length,busy=turns.some(turn=>["running","stopping"].includes(turn.state) || (turn.investigationAttempts || []).some(attempt=>attempt.status==="running"));
    const validDecision=latest.investigationDecision && investigationDecisionValid(latest.investigationDecision,latest.investigationContext),finished=latest.state==="complete" && !latest.completedWhileStopping && validDecision && latest.investigationDecision.decision.kind==="finish",ended=Boolean(root.investigationEnded || finished || modelUsed===3 && !busy);
    const permitted=!conversation.archived && !ended && !busy,decision=latest.state==="complete" && !latest.completedWhileStopping && validDecision && latest.investigationDecision.decision.kind==="investigate",attempts=latest.investigationAttempts || [],last=attempts.at(-1),successful=attempts.find(attempt=>attempt.status==="complete");
    const canRun=permitted && decision && !attempts.length && toolUsed<2,canRetryTool=permitted && decision && Boolean(last && ["failed","stopped","interrupted"].includes(last.status)) && toolUsed<2;
    const canContinue=permitted && modelUsed<3 && (latest===root || ["failed","stopped","interrupted"].includes(latest.state) || decision && Boolean(successful));
    const reason=conversation.archived?"Restore this conversation first.":root.investigationEnded?"This investigation was ended.":finished?"The model finished this investigation.":busy?"Wait for or stop the current owned step.":modelUsed>=3?"The three model-decision budget is exhausted.":decision && !successful?toolUsed>=2?"The two local-attempt budget is exhausted. End this investigation.":"Run the proposed local investigation before sharing its result.":"";
    return {valid:true,root,turns,latest,rootRequestId,latestRequestId:latest.requestId,modelUsed,toolUsed,busy,ended,finished,reason,canContinue:Boolean(canContinue),canRun:Boolean(canRun),canRetryTool:Boolean(canRetryTool),canEnd:!conversation.archived && !ended && !busy};
  }
  function investigationContextBasis(conversation,parentRequestId) {
    const parent=conversation?.turns.find(turn=>turn.requestId===parentRequestId),chain=investigationChain(conversation,parent?.investigationContext?.rootRequestId || parentRequestId);
    if(!chain.canContinue || chain.latestRequestId!==parentRequestId)return null;
    const failed=["failed","stopped","interrupted"].includes(parent.state),result=parent===chain.root?parent.sourceInvestigation:failed?parent.investigationContext.result:parent.investigationAttempts.find(attempt=>attempt.status==="complete")?.result;
    if(!sourceInvestigationSnapshot(result) || result.basisDigest!==chain.root.sourceInvestigation.basisDigest)return null;
    const decision=parent.investigationDecision,action=decision?.decision;
    const previousExplanation=parent===chain.root?{requestId:parent.requestId,kind:"answer",text:parent.answer}:failed?parent.investigationContext.previousExplanation:{requestId:parent.requestId,kind:"decision",text:JSON.stringify({title:decision.title,summary:decision.summary,decision:action.kind==="investigate"?{kind:"investigate",path:action.target.path,reason:action.reason}:{kind:"finish",conclusion:action.conclusion},limitations:decision.limitations})};
    const visited=new Set([chain.root.sourceInvestigation.anchor.path,...chain.turns.flatMap(turn=>(turn.investigationAttempts || []).filter(attempt=>attempt.status==="complete").map(attempt=>attempt.result.anchor.path))]),targets=[];
    if(chain.modelUsed+1<3 && chain.toolUsed<2){const byPath=new Map();for(const [index,edge] of result.edges.entries())for(const ref of [edge.from,edge.to]){if(visited.has(ref.path) || ref.path===result.anchor.path || !/\.(?:tsx?|jsx?|mjs|cjs)$/i.test(ref.path))continue;let target=byPath.get(ref.path);if(!target){if(byPath.size>=24)continue;target={id:`T${byPath.size+1}`,path:ref.path,revision:ref.revision,evidenceIds:[]};byPath.set(ref.path,target);}if(!target.evidenceIds.includes(`I${index+1}`))target.evidenceIds.push(`I${index+1}`);}targets.push(...byPath.values());}
    return {version:1,conversationId:conversation.id,rootRequestId:chain.rootRequestId,parentRequestId,result,goal:chain.root.question,previousExplanation,targets,budget:{modelStep:chain.modelUsed+1,modelLimit:3,toolsUsed:chain.toolUsed,toolLimit:2}};
  }
  function investigationContinuationState(value,conversation,binding,options={}) {
    const context=investigationContextSnapshot(value),basis=context && investigationContextBasis(conversation,context.parentRequestId),chain=investigationChain(conversation,context?.rootRequestId);
    const valid=Boolean(context && basis && Object.keys(basis).every(key=>JSON.stringify(context[key])===JSON.stringify(basis[key])) && context.result.projectId===options.projectId && context.result.featureId===options.featureId && options.intent==="plan" && options.paths?.length===1 && options.paths[0]===context.result.anchor.path);
    const refs=context?[context.result.anchor,...context.result.edges.flatMap(edge=>[edge.from,edge.to]),...context.result.requests.map(request=>request.source)]:[],dirty=refs.some(ref=>(options.dirtyPaths || []).includes(ref.path)),anchor=context && options.files?.find(file=>file.path===context.result.anchor.path);
    const descriptor=context?{version:1,conversationId:context.conversationId,rootRequestId:context.rootRequestId,parentRequestId:context.parentRequestId,digest:context.digest}:null,matched=JSON.stringify(descriptor)===JSON.stringify(binding?.prepared);
    const reason=!valid?"This checkpoint no longer matches the latest investigation. Remove it and prepare the latest decision."
      :options.historyReady===false?"Save conversation history before continuing."
      :options.running || binding?.busy?"Finish or stop the active step first."
      :context.result.featureRevision!==options.featureRevision?"The feature changed. End this chain and start a new source investigation."
      :dirty?"Resolve the affected source drafts before sharing saved evidence."
      :!options.refreshed || !matched?"Refresh checkpoint before sending. No investigation or AI request resumes automatically."
      :binding.status!=="ready"?binding.message || "This checkpoint changed. Prepare its latest decision before sharing."
      :!anchor?"Load the checkpoint's saved source before sending."
      :anchor.revision!==context.result.anchor.revision?"Saved source changed. End this chain and start a new source investigation."
      :"";
    return {valid,context,chain,matched,dirty,reason,canSend:!reason};
  }
  function requestRevisionState(descriptor, conversation, intent, paths=[], files=[], dirtyPaths=[]) {
    const parent=conversation?.turns?.find(turn=>turn.requestId===descriptor?.requestId);
    const valid=Boolean(descriptor?.version===1 && descriptor.conversationId===conversation?.id && parent && !parent.ephemeral && ["complete","stopped","failed","interrupted"].includes(parent.state) && !parent.alternativeGeneration && !parent.planContext && !parent.groupRevision && !parent.checkContext && !parent.sourceInvestigation && !parent.investigationContext && normalizeIntent(parent.intent)===normalizeIntent(intent) && Array.isArray(parent.context) && parent.context.length>0 && parent.context.length===paths.length && new Set(paths).size===paths.length && parent.context.every((source,index)=>source.path===paths[index]));
    const evidence=freshness(parent?.context || [],files,dirtyPaths);
    const reason=!valid ? "This saved request no longer matches the composer. Remove the revision and prepare it again."
      : conversation.archived ? "Restore this conversation before sending."
      : evidence.drafts.length ? "Save the selected files before revising this request."
      : evidence.status==="stale" ? "Source changed since this request. Remove the revision and start a new request."
      : evidence.status==="unknown" ? "Load the original saved source before revising this request."
      : "";
    return {valid,parent,evidence,reason};
  }
  function groupRevisionSources(descriptor,conversation) {
    const parent=conversation?.turns?.find(turn=>turn.requestId===descriptor?.requestId),group=parent?.changeSet;
    const valid=Boolean(descriptor?.version===1 && descriptor.conversationId===conversation?.id && group?.id===descriptor.groupId && parent.state==="complete" && !parent.completedWhileStopping && Array.isArray(parent.context) && parent.context.length>0 && Array.isArray(group.files) && group.files.length>0 && group.files.every(file=>parent.context.some(source=>source.path===file.path && source.revision===file.baseRevision && source.source===file.before)));
    const files=valid?parent.context.map(source=>{const staged=group.files.find(file=>file.path===source.path),text=staged?staged.after:source.source;return {path:source.path,revision:staged?null:source.revision,origin:staged?"staged":"saved",source:text,lines:text.split("\n").length};}):[];
    return {valid,parent,group,files};
  }
  function groupRevisionState(descriptor,conversation,session,intent,paths=[],files=[],dirtyPaths=[]) {
    const shared=groupRevisionSources(descriptor,conversation),group=session?.current;
    const valid=Boolean(shared.valid && intent==="build" && group?.id===descriptor.groupId && group.revision===descriptor.groupRevision && group.status==="proposed" && shared.group.files.length===group.files.length && shared.group.files.every((file,index)=>["id","path","baseRevision","before","after"].every(key=>file[key]===group.files[index]?.[key])) && shared.parent.context.length===paths.length && shared.parent.context.every((source,index)=>source.path===paths[index]));
    const evidence=freshness(shared.parent?.context || [],files,dirtyPaths);
    const reason=!valid?"This group changed. Remove the refinement and prepare the current group again."
      :conversation.archived?"Restore this conversation before refining the group."
      :session?.storage?.status!=="saved"?"Save the change group before refining it."
      :session?.busy?"Wait for the change group operation to finish."
      :evidence.drafts.length?"Save the selected files before refining this group."
      :evidence.status==="stale"?"The saved source changed. Check the group before refining it."
      :evidence.status==="unknown"?"Load the complete saved source basis before refining this group."
      :session?.assessment?.canApply!==true?session?.assessment?.reason || "Check the group source before refining it."
      :"";
    return {...shared,valid,evidence,reason};
  }
  function groupVersionChain(group,session) {
    const versions=session?.versions || [],byId=new Map(versions.map(item=>[item.group?.id,item]));
    const root=id=>{const seen=new Set();while(id && !seen.has(id)){seen.add(id);const entry=byId.get(id);if(!entry)return null;if(entry.parentId===null)return id;id=entry.parentId;}return null;};
    const rootId=root(group?.id);return rootId?versions.filter(item=>root(item.group?.id)===rootId):[];
  }
  function groupVersionState(group,session,options={}) {
    const retained=session?.versions?.some(item=>item.group?.id===group?.id && item.group.revision===group.revision),current=session?.current;
    const sharedBasis=Boolean(current && group && current.context?.length===group.context?.length && group.context.every((source,index)=>source.path===current.context[index].path && source.revision===current.context[index].revision));
    const dirty=(group?.context || []).some(source=>(options.dirtyPaths || []).includes(source.path));
    const reason=!retained?"This version is not retained in the active group history."
      :current?.id===group?.id?"This is the current version."
      :!groupVersionChain(group,session).some(item=>item.group.id===current?.id)?"Only a version in the current group’s history can be restored."
      :session?.acceptance || session?.versions?.find(item=>item.group?.id===group.id)?.acceptance?"Use whole proposal before restoring a group version.":current?.status!=="proposed" || group.status!=="proposed"?"Restore versions only while both groups are staged."
      :options.running || session.busy?"Wait for the current operation to finish."
      :options.executionBusy?"Stop the isolated check before restoring a version."
      :session.storage?.status!=="saved" || !options.historyReady?"Save the group and conversation history before restoring a version."
      :!options.trusted || !options.ownerReady?"Open this group in its active, completed conversation to restore a version."
      :dirty || !sharedBasis || session.assessment?.canApply!==true?"Check the unchanged saved source and resolve affected drafts before restoring a version."
      :"";
    return {retained,canRestore:!reason,reason};
  }
  function acceptsConversationSnapshot(snapshot, previous, projectId) {
    return Boolean(snapshot && [1,2,3,4,5,6,7,8,9,10,11].includes(snapshot.schemaVersion) && snapshot.projectId === projectId
      && Number.isSafeInteger(snapshot.revision) && snapshot.revision >= 0 && Array.isArray(snapshot.conversations)
      && (!previous || previous.projectId !== projectId || snapshot.revision >= previous.revision));
  }
  function verificationHistory(proposal, turns = []) {
    if (!proposal?.id) return [];
    const seen = new Set();
    return turns.flatMap(turn => turn.verificationHistory || []).filter(record => {
      if (!record || record.proposalId !== proposal.id || record.historical !== true || !record.id || seen.has(record.id)
        || typeof record.revision !== "string" || typeof record.runtimeSession !== "string" || typeof record.previewRevision !== "string"
        || !["passed", "failed", "not-run"].includes(record.compilation)) return false;
      seen.add(record.id); return true;
    }).map(record => ({id:record.id, proposalId:record.proposalId, revision:record.revision,
      previewRevision:record.previewRevision, runtimeSession:record.runtimeSession, recordedAt:record.recordedAt,
      compilation:record.compilation, interaction:"not-run", visual:"not-run", observed:record.observed === true, historical:true}));
  }
  function acceptanceState(group,session,options={}) {
    const current=Boolean(group && session?.current?.id===group.id && session.current.revision===group.revision),value=current?session.acceptance:session?.versions?.find(item=>item.group?.id===group?.id && item.group.revision===group.revision)?.acceptance;
    const plan=value?.plan,files=group?.files || [],units=Array.isArray(plan?.units)?plan.units:[],ids=units.map(unit=>unit?.id),paths=units.flatMap(unit=>Array.isArray(unit?.paths)?unit.paths:[]),selectedIds=value?.selectedUnitIds,appliedIds=value?.appliedUnitIds;
    const valid=Boolean(value && plan?.version===1 && plan.groupId===group?.id && /^[a-f0-9]{64}$/.test(plan.groupDigest || "") && /^[a-f0-9]{64}$/.test(plan.digest || "") && ["partitioned","atomic"].includes(plan.mode) && units.length>0 && units.length<=8 && new Set(ids).size===ids.length && units.every(unit=>/^unit-[a-f0-9]{16}$/.test(unit.id || "") && typeof unit.label==="string" && unit.label.length>0 && unit.label.length<=1000 && Array.isArray(unit.paths) && unit.paths.length>0 && unit.paths.every(path=>files.some(file=>file.path===path))) && paths.length===files.length && new Set(paths).size===paths.length && files.every(file=>paths.includes(file.path)) && Array.isArray(plan.boundaries) && plan.boundaries.length<=32 && plan.boundaries.every(item=>typeof item==="string" && item.length<=4000) && [selectedIds,appliedIds].every(list=>Array.isArray(list) && new Set(list).size===list.length && list.every(id=>ids.includes(id))) && selectedIds.every(id=>!appliedIds.includes(id)));
    const selected=valid?units.filter(unit=>selectedIds.includes(unit.id)):[],applied=valid?units.filter(unit=>appliedIds.includes(unit.id)):[],pending=valid?units.filter(unit=>!appliedIds.includes(unit.id)):[];
    const safe=current && options.trusted===true && options.ownerReady===true && options.historyReady===true && !options.running && !options.executionBusy && !session?.busy && session?.storage?.status==="saved",assessment=current?session?.assessment:null;
    const canPrepare=Boolean(safe && !value && group.status==="proposed" && assessment?.canPrepareAcceptance),canSelect=Boolean(safe && valid && ["proposed","partially-applied"].includes(group.status) && assessment?.canSelectUnits),canClear=Boolean(safe && valid && group.status==="proposed" && !applied.length && assessment?.canClearAcceptance===true);
    return {current,value:value || null,valid,plan:valid?plan:null,units:valid?units:[],selected,applied,pending,selectedPaths:selected.flatMap(unit=>unit.paths),appliedPaths:applied.flatMap(unit=>unit.paths),fullSelection:!value || valid && !applied.length && selected.length===units.length,canPrepare,canSelect,canClear,reason:value && !valid?"The saved acceptance scope is unavailable. Refresh this group before changing source.":valid && !selected.length && ["proposed","partially-applied"].includes(group.status)?"Choose at least one pending change to apply.":""};
  }
  function changeSetState(group,session,options={}) {
    if(!group)return null;
    const current=Boolean(session?.current?.id===group.id && session.current.revision===group.revision),acceptance=acceptanceState(group,session,options);
    const busy=Boolean(session?.busy) || ["applying","undoing"].includes(group.status);
    const stored=session?.storage?.status==="saved",assessment=current?session?.assessment:null;
    const safe=current && options.trusted===true && !options.running && !busy;
    const writable=safe && stored && !options.executionBusy && options.ownerReady===true && options.historyReady===true;
    const rows=group.files.map(file=>assessment?.files?.find(item=>item.path===file.path));
    const dirtyTargets=rows.some(row=>row?.dirty) || group.files.some(file=>(options.dirtyPaths || []).includes(file.path)),dirtyBasis=(group.context || []).some(file=>(options.dirtyPaths || []).includes(file.path));
    const dirty=dirtyTargets || ["proposed","partially-applied"].includes(group.status) && dirtyBasis,conflicts=rows.some(row=>row?.state==="conflict"),unknown=rows.some(row=>!row || row.state==="unavailable");
    const targetBlocked=paths=>paths.some(path=>{const row=assessment?.files?.find(item=>item.path===path);return !row || row.dirty || ["conflict","unavailable"].includes(row.state) || (options.dirtyPaths || []).includes(path);});
    const undoPaths=acceptance.value?acceptance.appliedPaths:group.files.map(file=>file.path),recoveryPaths=Array.isArray(assessment?.operationPaths)?assessment.operationPaths:group.files.map(file=>file.path);
    const canApply=writable && ["proposed","partially-applied"].includes(group.status) && assessment?.canApply===true && !dirty && !conflicts && !unknown && (group.status!=="partially-applied" || acceptance.valid) && (!acceptance.value || acceptance.valid && acceptance.selected.length>0);
    const canUndo=writable && ["applied","partially-applied"].includes(group.status) && assessment?.canUndo===true && (group.status!=="partially-applied" || acceptance.valid) && (!acceptance.value || acceptance.valid) && undoPaths.length>0 && !targetBlocked(undoPaths);
    const canRecover=safe && stored && !options.executionBusy && group.status==="recovery-required" && assessment?.canRecover===true && (!acceptance.value || acceptance.valid) && recoveryPaths.length>0 && !targetBlocked(recoveryPaths);
    const reason=!current?"This saved change group is read-only.":busy?"A change group operation is in progress.":options.executionBusy?"An isolated check is in progress. Stop it before changing this group.":!stored?session?.storage?.message || "Change group storage must be saved before source actions.":acceptance.value && !acceptance.valid?acceptance.reason:assessment?.reason || (dirty?"Resolve the affected editor drafts before changing source.":conflicts?"Source changed. The group cannot overwrite those edits.":unknown?"Check source to confirm all files before changing source.":!options.ownerReady && group.status!=="recovery-required"?"This request is read-only. Open its active, completed conversation to change source.":acceptance.reason);
    return {current,busy,acceptance,canApply,canUndo,canRecover,canDiff:(safe || Boolean(session?.versions?.some(item=>item.group?.id===group.id && item.group.revision===group.revision)) && options.trusted===true && !options.running && !busy) && stored,canRefresh:safe,
      canDiscard:safe && stored && !options.executionBusy && ["proposed","partially-applied","stale","applied"].includes(group.status),
      status:!current?"Previous group":({proposed:"Staged","partially-applied":"Partially applied",applying:"Applying…",applied:"Applied",undoing:"Undoing…",undone:"Undone","recovery-required":"Recovery needed",discarded:"Discarded",stale:"Stale"})[group.status] || "Unavailable",
      freshness:!current?"Saved snapshots":busy?"Checkpoint operation in progress":conflicts || group.status==="stale"?"Source changed":dirty?"Unsaved changes excluded":unknown?"Source not checked":group.status==="recovery-required"?"Checkpoint requires recovery":group.status==="partially-applied"?"Applied and pending source":group.status==="proposed" && acceptance.valid && !acceptance.selected.length?"Selection required":group.status==="proposed" && assessment?.canApply!==true?"Source needs review":group.status==="applied"?"Matches applied source":"Matches saved source",reason};
  }
  function executionState(group,session,options={}) {
    if(!group)return null;
    const current=session?.current?.groupId===group.id?session.current:null;
    const records=[...(current?[current]:[]),...(Array.isArray(session?.history)?session.history:[])].filter((record,index,list)=>record?.groupId===group.id && list.findIndex(other=>other?.id===record.id)===index);
    const latest=current || records.at(-1) || null,busy=Boolean(session?.busy),stored=session?.storage?.status==="saved";
    const supported=session?.capabilities?.supported===true && session.capabilities.network==="blocked" && session.capabilities.filesystem==="isolated-copy";
    const basis=options.current===true && group.status==="proposed" && options.groupReady===true;
    const owner=options.trusted===true && options.ownerReady===true && options.historyReady===true && !options.running;
    const planActive=Boolean(session?.planSession?.busy || ["paused","running"].includes(session?.planSession?.current?.status));
    const safe=supported && stored && !busy && !planActive && basis && owner;
    const exact=Boolean(current && current.groupRevision===group.revision);
    const canPrepare=safe && session?.assessment?.canPrepare===true;
    const canRun=safe && exact && current.status==="ready" && current.tasks?.length>0 && session?.assessment?.canRun===true;
    const canStop=Boolean(options.trusted===true && current && !current.plan && ["preparing","running"].includes(current.status) && session?.assessment?.canStop===true);
    const canRetry=Boolean(options.trusted===true && !options.running && !busy && ["error","unavailable"].includes(session?.storage?.status));
    const reason=!session?"Isolated checks are unavailable.":!supported?session.capabilities?.reason || "This host cannot enforce isolated tool execution.":!stored?session.storage?.message || "Save the execution record before continuing.":planActive?"Finish or end the check plan before preparing another workspace.":busy&&!current?"Another isolated check is in progress.":!options.current?"This result belongs to a previous change group.":!owner?"Open this completed group in its active conversation to prepare or run a check.":!basis&&!busy?"Prepare checks from a current staged group with unchanged saved source and no affected drafts.":session.assessment?.reason || "";
    const labels={preparing:"Preparing workspace…",ready:"Ready to run",running:"Running…",passed:"Command passed",failed:"Command failed",cancelled:"Cancelled",interrupted:"Interrupted",unavailable:"Unavailable"};
    return {current,latest,records,busy,supported,canPrepare,canRun,canStop,canRetry,status:labels[latest?.status] || "Not run",reason,
      historical:Boolean(latest && (!current || !options.current || latest.groupRevision!==group.revision)),statusLabel:status=>labels[status] || "Unavailable"};
  }
  function checkPlanState(group,execution,options={}) {
    const session=execution?.planSession,current=session?.current || null,assessment=session?.assessment || {};
    const active=Boolean(current && ["paused","running"].includes(current.status)),busy=Boolean(session?.busy || execution?.busy);
    const plans=[...(session?.history || []),...(current?[current]:[])],plan=current?.groupId===group?.id || active && options.current ? current : plans.filter(item=>item.groupId===group?.id).at(-1) || null;
    const selected=Boolean(plan && plan.id===current?.id),exact=Boolean(selected && options.current && plan.groupId===group?.id && plan.groupRevision===group?.revision);
    const owner=options.trusted===true && options.ownerReady===true && options.historyReady===true && !options.running;
    const stored=session?.storage?.status==="saved",idle=!busy && !execution?.busy;
    const supported=execution?.capabilities?.supported===true && execution.capabilities.network==="blocked" && execution.capabilities.filesystem==="isolated-copy";
    const source=group?.status==="proposed" && options.groupReady===true;
    const safe=owner && stored && idle && supported && execution?.storage?.status==="saved";
    const ready=execution?.current,canCreate=Boolean(safe && !active && options.current && source && ready?.status==="ready" && ready.groupId===group.id && ready.groupRevision===group.revision && ready.tasks?.length && assessment.canCreate);
    const next=selected?plan.steps.find(step=>step.id===assessment.nextStepId):null,retry=selected?plan.steps.find(step=>step.id===assessment.retryStepId):null;
    const canRunNext=Boolean(safe && exact && source && plan.status==="paused" && next?.status==="pending" && !next.attempts.length && assessment.canRunNext);
    const canRetryStep=Boolean(safe && exact && source && plan.status==="paused" && retry?.status==="pending" && ["failed","cancelled","interrupted","unavailable"].includes(retry.attempts.at(-1)?.status) && assessment.canRetryStep);
    const canSkipStep=Boolean(owner && stored && idle && exact && plan.status==="paused" && next?.status==="pending" && assessment.canSkipStep);
    const canStop=Boolean(options.trusted && busy && selected && active && plan.activeAttemptId && plan.steps.some(step=>step.attempts.some(attempt=>attempt.id===plan.activeAttemptId && ["preparing","ready","running"].includes(attempt.status))) && assessment.canStop);
    const canEnd=Boolean(options.trusted && selected && active && idle && stored && assessment.canEnd);
    const canRetryStorage=Boolean(options.trusted && idle && ["error","unavailable"].includes(session?.storage?.status));
    const preparationReason=selected && active && idle && plan.status==="paused" && (next || retry) && !canRunNext && !canRetryStep && execution?.assessment?.canPrepare===false ? execution.assessment.reason || "" : "";
    const reason=!session?"":!stored?session.storage?.message || "Save the check plan before continuing.":selected && active && !exact?"This plan belongs to an earlier group or revision. End it before starting a new plan.":assessment.reason || (selected && active && !owner?"Open this group in its active, completed conversation to continue the plan.":selected && active && !source && !busy?"The source changed or has affected drafts. Check the source before running; Skip and End do not run tools.":preparationReason);
    const passed=plan?.steps.filter(step=>step.status==="passed").length || 0,skipped=plan?.steps.filter(step=>step.status==="skipped").length || 0;
    const status=plan?.status==="running"?(busy?"Running a check…":"Awaiting saved outcome"):plan?.status==="ended"?"Ended":plan?.status==="completed"?`${passed} passed${skipped?` · ${skipped} skipped`:""}`:"Waiting for your next step";
    const recordFor=(step,attempt)=>[execution?.current,...(execution?.history || [])].find(record=>record?.id===attempt.executionId && record.groupId===plan?.groupId && record.groupRevision===plan?.groupRevision && record.plan?.planId===plan?.id && record.plan.stepId===step.id && record.plan.attemptId===attempt.id) || null;
    return {session,current,plan,plans,active,busy,selected,exact,next,retry,canCreate,canRunNext,canRetryStep,canSkipStep,canStop,canEnd,canRetryStorage,reason,status,passed,skipped,recordFor};
  }
  function checkContextState(descriptor,conversation,groups,execution,intent,paths=[],files=[],dirtyPaths=[]) {
    const shared=groupRevisionSources(descriptor,conversation),tasks=descriptor?.tasks || [],group=groups?.current;
    const catalog=Array.isArray(tasks) && tasks.length>0 && tasks.length<=2 && new Set(tasks.map(task=>task.id)).size===tasks.length && tasks.every(task=>["node:test","typescript:check"].includes(task.id) && typeof task.label==="string" && task.label.length>0 && task.label.length<=160);
    const valid=Boolean(shared.valid && intent==="plan" && catalog && typeof descriptor.snapshotRevision==="string" && /^[a-f0-9]{64}$/.test(descriptor.snapshotRevision) && !shared.parent.checkContext && paths.length===shared.parent.context.length && shared.parent.context.every((file,index)=>file.path===paths[index]));
    const sameGroup=Boolean(valid && group?.id===descriptor.groupId && group.revision===descriptor.groupRevision && group.status==="proposed" && group.files.length===shared.group.files.length && group.files.every((file,index)=>["id","path","baseRevision","before","after"].every(key=>file[key]===shared.group.files[index]?.[key])));
    const evidence=freshness(shared.parent?.context || [],files,dirtyPaths),record=execution?.current;
    const ready=Boolean(record?.status==="ready" && record.groupId===descriptor?.groupId && record.groupRevision===descriptor?.groupRevision && record.groupDigest===descriptor?.groupDigest && record.snapshotRevision===descriptor?.snapshotRevision && record.tasks?.length===tasks.length && tasks.every((task,index)=>task.id===record.tasks[index]?.id && task.label===record.tasks[index]?.label));
    const reason=!valid?"This check request no longer matches its saved group. Remove it and prepare Suggest checks again."
      :conversation.archived?"Restore this conversation before planning checks."
      :!sameGroup?"The staged group changed. Prepare Suggest checks from the current group."
      :groups?.storage?.status!=="saved"?"Save the staged group before planning checks."
      :groups?.busy || execution?.busy || execution?.planSession?.busy?"Wait for the current operation to finish."
      :evidence.drafts.length?"Save the selected files before planning checks."
      :evidence.status==="stale"?"The saved source changed. Prepare Suggest checks again from current source."
      :evidence.status==="unknown"?"Load the original saved source before planning checks."
      :groups?.assessment?.canApply!==true?groups?.assessment?.reason || "Check the staged group source before planning checks."
      :execution?.storage?.status!=="saved"?execution?.storage?.message || "Save execution history before planning checks."
      :["paused","running"].includes(execution?.planSession?.current?.status)?"Finish or end the current check plan before saving another."
      :!ready?"Prepare workspace again to confirm the staged source and supported checks."
      :"";
    return {...shared,valid,sameGroup,evidence,ready,record,tasks,reason};
  }
  function checkSuggestionState(turn,conversation,groups,execution,files=[],dirtyPaths=[],options={}) {
    const artifact=turn?.checkSuggestion;if(!artifact)return null;
    const context=turn.checkContext,basis=checkContextState(context,conversation,groups,execution,turn.intent,(turn.context || []).map(file=>file.path),files,dirtyPaths);
    const plans=[...(execution?.planSession?.history || []),...(execution?.planSession?.current?[execution.planSession.current]:[])];
    const accepted=plans.find(plan=>plan.recommendation?.conversationId===conversation?.id && plan.recommendation.requestId===turn.requestId && plan.recommendation.artifactId===artifact.id && /^[a-f0-9]{64}$/.test(plan.recommendation.artifactDigest || "") && plan.projectId===artifact.projectId && plan.groupId===context?.groupId && plan.groupRevision===context?.groupRevision && plan.groupDigest===context?.groupDigest && plan.snapshotRevision===context?.snapshotRevision && plan.steps.every(step=>context.tasks.some(task=>task.id===step.task.id && task.label===step.task.label))) || null;
    const taskIds=options.taskIds || artifact.checks.map(check=>check.taskId),selectionValid=Array.isArray(taskIds) && taskIds.length>0 && taskIds.length<=2 && new Set(taskIds).size===taskIds.length && taskIds.every(id=>context?.tasks.some(task=>task.id===id));
    const terminal=turn.state==="complete" && !turn.completedWhileStopping && !turn.ephemeral,owner=options.trusted===true && !options.running && conversation?.archived!==true && options.currentConversation===true;
    const editable=terminal && owner && !turn.checkDismissed && !accepted;
    const reason=!terminal?"This suggestion did not finish as a complete saved response. No checks can be saved from it."
      :accepted?"":turn.checkDismissed?"This suggestion was dismissed. Its original rationale is preserved."
      :!owner?"Open this completed suggestion in its active conversation to choose checks."
      :options.historyReady!==true?"Save conversation history before choosing checks."
      :basis.reason || (!selectionValid?"Choose at least one supported check to save a plan.":execution?.planSession?.storage?.status!=="saved"?execution?.planSession?.storage?.message || "Save check-plan storage before continuing.":execution?.planSession?.assessment?.canCreate!==true?execution?.planSession?.assessment?.reason || "A new check plan is not available. Review the current plan and retained storage.":"");
    return {basis,accepted,taskIds,selectionValid,reason,canEdit:editable,canSave:editable && !reason,canDismiss:editable && options.historyReady===true,canOpen:Boolean(accepted && options.trusted),status:accepted?"Check plan saved":turn.checkDismissed?"Dismissed":!terminal?"Incomplete suggestion":"Not saved"};
  }
  function normalizeIntent(value) { return value === "change" ? "build" : ["ask", "plan", "build", "review"].includes(value) ? value : "ask"; }
  function planRevision(turn, revision) {
    const revisions=turn?.planRevisions || [];
    return revision===undefined ? revisions.at(-1) || null : revisions.find(item=>item.revision===revision) || null;
  }
  function planValues(value) {
    return {title:value.title,summary:value.summary,steps:value.steps.map(step=>({id:step.id,title:step.title,detail:step.detail,included:step.included})),risks:[...value.risks],verification:[...value.verification]};
  }
  function planDraftValid(value, original, bytes=value=>new TextEncoder().encode(value).length) {
    const text=(value,max)=>typeof value==="string" && Boolean(value.trim()) && bytes(value.trim())<=max;
    return Boolean(value && original && text(value.title,160) && text(value.summary,2000) && Array.isArray(value.steps) && value.steps.length===original.steps.length && value.steps.length<=16 && new Set(value.steps.map(step=>step.id)).size===value.steps.length && value.steps.every(step=>original.steps.some(item=>item.id===step.id) && text(step.title,160) && text(step.detail,2000) && typeof step.included==="boolean") && [value.risks,value.verification].every(list=>Array.isArray(list) && list.length<=12 && list.every(item=>text(item,500))));
  }
  function planStepState(turn, stepId, files=[], dirtyPaths=[]) {
    const revision=planRevision(turn),step=revision?.steps.find(item=>item.id===stepId),original=turn?.plan?.steps.find(item=>item.id===stepId);
    const paths=[...new Set((original?.references || []).map(ref=>ref.path))],evidence=freshness(turn?.context || [],files,dirtyPaths);
    const reason=!step || !original ? "Choose a saved plan step." : !step.included ? "Include this step in the saved plan before Build." : paths.length!==1 ? paths.length ? "This step spans multiple files. Plan-step handoff currently supports one file." : "This step has no referenced source file. Build needs evidence in one file." : evidence.drafts.length ? "Save or discard affected source drafts before preparing Build." : evidence.status==="stale" ? "Source changed. Create a new plan from current source." : evidence.status==="unknown" ? "Check source before preparing Build." : "";
    return {revision,step,original,paths,evidence,reason,canPrepare:turn?.state==="complete" && !reason};
  }
  const api = Object.freeze({investigationContextSnapshot, investigationDecisionValid, investigationChain, investigationContextBasis, investigationContinuationState, sourceInvestigationSnapshot, sourceInvestigationState, groupRevisionSources, groupRevisionState, groupVersionState, groupVersionChain, requestRevisionState, checkContextState, checkSuggestionState, checkPlanState, executionState, changeSetState, acceptanceState, normalizeIntent, planRevision, planValues, planDraftValid, planStepState, freshness, proposalState, verification, acceptsEvent, acceptsConversationSnapshot, verificationHistory});
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.FoundationArtifacts = api;
})();
