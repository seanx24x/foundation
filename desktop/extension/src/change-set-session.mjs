import {randomUUID,createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {mkdir,lstat,open,rename,rm} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {validateChangeSet,changeGroupDigest} from '../../../server/project/proposals.mjs';
import {createAcceptancePlan,validateAcceptancePlan} from '../../../server/project/acceptance-units.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex').slice(0,16);
const clone=value=>structuredClone(value);
const object=value=>value && typeof value==='object' && !Array.isArray(value);
const uuid=value=>typeof value==='string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
const date=value=>typeof value==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value;
const fail=(code,message)=>Object.assign(new Error(message),{name:'ChangeSetError',code});
const MAX_BYTES=4*1024*1024;
const MAX_VERSIONS=64;
const MAX_CHAIN_VERSIONS=8;
const STORAGE_ERROR='The staged snapshots could not be saved. Retry local storage before continuing.';
const SELECTION_SYNC_ERROR='The version selection was committed, but its directory sync could not be confirmed. Retry local storage before continuing.';
const UNAVAILABLE='The saved change set could not be read safely. Its storage has been left untouched.';

/** External staged snapshots and an explicit recovery journal; never a worktree or execution sandbox. */
export function createChangeSetSession({storageRoot,projectId,getFile,isDirty=()=>false,applyBatch,isCurrent=()=>true,onChange=()=>{},onCheckpoint=()=>{},validateAlternative=async()=>false}) {
  if(typeof storageRoot!=='string' || !isAbsolute(storageRoot) || typeof projectId!=='string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(projectId))
    throw fail('invalid-storage','Choose project-owned change-set storage.');
  const filename=join(storageRoot,'checkpoint.json');
  const views=value=>Object.defineProperties(value,{
    current:{get(){return this.versions.find(item=>item.group.id===this.activeId)?.group??null;}},
    acceptance:{get(){return this.versions.find(item=>item.group.id===this.activeId)?.acceptance??null;},set(value){const selected=this.versions.find(item=>item.group.id===this.activeId);if(selected)selected.acceptance=value;}},
    checkpoints:{get(){return this.versions.find(item=>item.group.id===this.activeId)?.checkpoints??[];},set(items){const selected=this.versions.find(item=>item.group.id===this.activeId);if(selected)selected.checkpoints=items;}},
  });
  const empty=()=>views({schemaVersion:3,projectId,activeId:null,versions:[],operation:null});
  const copyData=value=>views(clone(value));
  let data=empty(),loaded=false,busy=false,disposed=false,error,storage={status:'unavailable',message:'Load the staged snapshots before continuing.'};
  let assessment={files:[],canApply:false,canUndo:false,canRecover:false};
  const publicAcceptance=value=>value?{plan:clone(value.plan),selectedUnitIds:[...value.selectedUnitIds],appliedUnitIds:[...value.appliedUnitIds]}:null;
  const snapshot=()=>({current:clone(data.current),busy,...(error?{error}:{}),storage:{...storage},assessment:clone(assessment),checkpoints:clone(data.checkpoints),versions:data.versions.map(item=>({...clone(item),acceptance:publicAcceptance(item.acceptance)})),acceptance:publicAcceptance(data.acceptance)});
  let tokenGroup,tokenRevision,tokenStatus,tokenAcceptance,tokenSelection,tokenApplied,tokenValue;
  const ownershipToken=()=>{const current=data.current,acceptance=data.acceptance,selection=acceptance?.selectedUnitIds.join('\0'),applied=acceptance?.appliedUnitIds.join('\0');if(!tokenValue||tokenGroup!==current||tokenRevision!==current?.revision||tokenStatus!==current?.status||tokenAcceptance!==acceptance||tokenSelection!==selection||tokenApplied!==applied){tokenGroup=current;tokenRevision=current?.revision;tokenStatus=current?.status;tokenAcceptance=acceptance;tokenSelection=selection;tokenApplied=applied;tokenValue=Object.freeze({});}return tokenValue;};
  const notify=()=>{try{onChange(snapshot());}catch{}};
  const owned=()=>{if(disposed||!isCurrent())throw fail('operation-retired','The project is no longer available for this operation.');};
  const available=()=>{owned();if(!loaded || storage.status==='unavailable')throw fail('storage-unavailable',UNAVAILABLE);if(storage.status==='error')throw fail('storage-error',STORAGE_ERROR);};
  const action=async work=>{
    if(busy)throw fail('operation-active','Wait for the current change-set operation to finish.');
    busy=true;error=undefined;notify();
    try{await work();}catch(caught){error=caught?.code==='storage-error'?(caught.committed?SELECTION_SYNC_ERROR:STORAGE_ERROR):caught?.code==='storage-unavailable'?UNAVAILABLE:typeof caught?.message==='string' && caught.name==='ChangeSetError'?caught.message:'The change-set operation could not finish. Inspect its source and recovery state.';throw caught;}
    finally{busy=false;notify();}
    return snapshot();
  };
  const validateLegacy=(input,{partial=false}={})=>{
    if(!object(input)||Object.keys(input).some(key=>!['schemaVersion','projectId','current','operation','checkpoints'].includes(key))||input.schemaVersion!==1||input.projectId!==projectId||!Array.isArray(input.checkpoints)||input.checkpoints.length>32)throw Error('Invalid checkpoint');
    const current=input.current===null?null:validateChangeSet(input.current,projectId);
    if(!partial&&current?.status==='partially-applied')throw Error('Legacy acceptance is unsupported');
    if(current && current.files.some(file=>file.baseRevision!==hash(file.before)||file.appliedRevision!==undefined&&file.appliedRevision!==hash(file.after)))throw Error('Invalid revision');
    const checkpoints=input.checkpoints.map(item=>{
      if(!object(item)||Object.keys(item).some(key=>!['id','kind','createdAt'].includes(key))||!uuid(item.id)||!['staged','applied','undone','recovered'].includes(item.kind)||!date(item.createdAt))throw Error('Invalid checkpoint record');
      return {id:item.id,kind:item.kind,createdAt:item.createdAt};
    });
    if(new Set(checkpoints.map(item=>item.id)).size!==checkpoints.length || !current&&checkpoints.length)throw Error('Invalid history');
    let operation=null;
    if(input.operation!==null){
      const item=input.operation;
      if(!current||!object(item)||Object.keys(item).some(key=>!['id','kind','startedAt','recoveryTarget','writtenPaths'].includes(key))||!uuid(item.id)||!['apply','undo','recover'].includes(item.kind)||!date(item.startedAt)||!['before','after'].includes(item.recoveryTarget)||!Array.isArray(item.writtenPaths)||item.writtenPaths.length>8||new Set(item.writtenPaths).size!==item.writtenPaths.length||item.writtenPaths.some(path=>!current.files.some(file=>file.path===path))||item.kind==='apply'&&item.recoveryTarget!=='before'||item.kind==='undo'&&item.recoveryTarget!=='after')throw Error('Invalid operation');
      operation={id:item.id,kind:item.kind,startedAt:item.startedAt,recoveryTarget:item.recoveryTarget,writtenPaths:[...item.writtenPaths]};
    }
    if(current && ['applying','undoing','recovery-required'].includes(current.status)!==Boolean(operation))throw Error('Missing operation journal');
    if(operation&&((current.status==='applying'&&operation.kind!=='apply')||(current.status==='undoing'&&operation.kind!=='undo')||(operation.kind==='recover'&&current.status!=='recovery-required')))throw Error('Invalid operation state');
    if(!partial && current && (['applied','undoing','undone'].includes(current.status)||operation?.recoveryTarget==='after')&&current.files.some(file=>file.appliedRevision!==hash(file.after)))throw Error('Missing applied revision');
    return {schemaVersion:1,projectId,current,operation,checkpoints};
  };
  const sameBasis=(parent,child)=>parent.context.length===child.context.length && parent.context.every((source,index)=>
    source.path===child.context[index].path && source.revision===child.context[index].revision) && child.files.every(file=>{
      const prior=parent.files.find(item=>item.path===file.path);return !prior || prior.before===file.before && prior.baseRevision===file.baseRevision;
    });
  const chainRoot=(id,state=data)=>{
    const seen=new Set();let current=state.versions.find(item=>item.group.id===id);
    while(current?.parentId!==null){if(!current||seen.has(current.group.id))return null;seen.add(current.group.id);current=state.versions.find(item=>item.group.id===current.parentId);}
    return current?.group.id??null;
  };
  const orderedIds=(plan,ids)=>{
    if(!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.some(id=>!plan.units.some(unit=>unit.id===id)))throw Error('Invalid acceptance units');
    return plan.units.filter(unit=>ids.includes(unit.id)).map(unit=>unit.id);
  };
  const acceptanceValue=(value,group)=>{
    if(value===null||value===undefined)return null;
    if(group.origin!=='ai')throw Error('Retained alternatives cannot have partial acceptance');
    if(!object(value)||Object.keys(value).some(key=>!['plan','selectedUnitIds','appliedUnitIds','basis'].includes(key)))throw Error('Invalid acceptance');
    const plan=validateAcceptancePlan(value.plan,group);
    if(!Array.isArray(value.basis)||value.basis.some(file=>!object(file)||Object.keys(file).length!==3||Object.keys(file).some(key=>!['path','revision','source'].includes(key)))||JSON.stringify(createAcceptancePlan({group,files:value.basis}))!==JSON.stringify(plan))throw Error('Invalid source acceptance basis');
    const selectedUnitIds=orderedIds(plan,value.selectedUnitIds),appliedUnitIds=orderedIds(plan,value.appliedUnitIds);
    if(JSON.stringify(selectedUnitIds)!==JSON.stringify(value.selectedUnitIds)||JSON.stringify(appliedUnitIds)!==JSON.stringify(value.appliedUnitIds)||selectedUnitIds.some(id=>appliedUnitIds.includes(id)))throw Error('Invalid acceptance order');
    const applied=new Set(plan.units.filter(unit=>appliedUnitIds.includes(unit.id)).flatMap(unit=>unit.paths));
    if(group.status==='proposed'&&applied.size||group.status==='partially-applied'&&(!applied.size||applied.size===group.files.length)||group.status==='applied'&&applied.size!==group.files.length||group.status==='undone'&&applied.size)throw Error('Invalid acceptance lifecycle');
    if(['proposed','partially-applied','applied'].includes(group.status)&&group.files.some(file=>Boolean(file.appliedRevision)!==applied.has(file.path)))throw Error('Invalid accepted revisions');
    if(plan.units.some(unit=>{const flags=unit.paths.map(path=>Boolean(group.files.find(file=>file.path===path).appliedRevision));return flags.some(Boolean)&&!flags.every(Boolean);}))throw Error('Incomplete accepted unit metadata');
    return {plan,selectedUnitIds,appliedUnitIds,basis:clone(value.basis)};
  };
  const validate=input=>{
    if(input?.schemaVersion===1){
      const prior=validateLegacy(input),result=empty();
      if(prior.current){result.activeId=prior.current.id;result.versions.push({parentId:null,group:prior.current,checkpoints:prior.checkpoints,acceptance:null});}
      result.operation=prior.operation?{groupId:prior.current.id,...prior.operation}:null;return result;
    }
    if(!object(input)||Object.keys(input).some(key=>!['schemaVersion','projectId','activeId','versions','operation'].includes(key))||![2,3].includes(input.schemaVersion)||input.projectId!==projectId||
      !Array.isArray(input.versions)||input.versions.length>MAX_VERSIONS||!(input.activeId===null||uuid(input.activeId)))throw Error('Invalid versions');
    const versions=[],seen=new Map();
    for(const item of input.versions){
      if(!object(item)||Object.keys(item).some(key=>!['parentId','group','checkpoints',...(input.schemaVersion===3?['acceptance']:[])].includes(key))||!(item.parentId===null||uuid(item.parentId)))throw Error('Invalid version');
      const acceptance=input.schemaVersion===3?acceptanceValue(item.acceptance,item.group):null,operation=item.group?.id===input.activeId?input.operation:null;
      if(operation!==null&&(!object(operation)||operation.groupId!==input.activeId||Object.keys(operation).some(key=>!['groupId','id','kind','startedAt','recoveryTarget','writtenPaths',...(acceptance?['paths','priorAppliedUnitIds','targetAppliedUnitIds','priorSelectedUnitIds']:[])].includes(key))))throw Error('Invalid operation owner');
      if(operation&&acceptance){
        if(!Array.isArray(operation.paths)||!operation.paths.length||new Set(operation.paths).size!==operation.paths.length||operation.paths.some(path=>!item.group.files.some(file=>file.path===path))||operation.writtenPaths.some(path=>!operation.paths.includes(path)))throw Error('Invalid acceptance operation paths');
        const prior=orderedIds(acceptance.plan,operation.priorAppliedUnitIds),target=orderedIds(acceptance.plan,operation.targetAppliedUnitIds),selection=orderedIds(acceptance.plan,operation.priorSelectedUnitIds);
        if(JSON.stringify(prior)!==JSON.stringify(acceptance.appliedUnitIds)||selection.some(id=>prior.includes(id))||JSON.stringify(selection)!==JSON.stringify(acceptance.selectedUnitIds))throw Error('Invalid operation prestate');
        const affected=acceptance.plan.units.filter(unit=>prior.includes(unit.id)!==target.includes(unit.id)).flatMap(unit=>unit.paths);
        const expectedTarget=operation.recoveryTarget==='before'?orderedIds(acceptance.plan,[...prior,...selection]):[];
        if(affected.length!==operation.paths.length||affected.some(path=>!operation.paths.includes(path))||JSON.stringify(target)!==JSON.stringify(expectedTarget)||operation.recoveryTarget==='before'&&!selection.length||operation.recoveryTarget==='after'&&!prior.length)throw Error('Invalid operation scope');
        const metadata=item.group.files.filter(file=>file.appliedRevision).map(file=>file.path),priorPaths=unitPaths(acceptance,prior),targetPaths=unitPaths(acceptance,target),matches=paths=>paths.length===metadata.length&&paths.every(path=>metadata.includes(path));
        if(!matches(priorPaths)&&!(operation.recoveryTarget==='before'&&matches(targetPaths)))throw Error('Invalid interrupted applied revisions');
      }
      const legacyOperation=operation?Object.fromEntries(['id','kind','startedAt','recoveryTarget','writtenPaths'].map(key=>[key,operation[key]])):null;
      const checked=validateLegacy({schemaVersion:1,projectId,current:item.group,checkpoints:item.checkpoints,operation:legacyOperation},{partial:Boolean(acceptance)});
      if(!checked.current||seen.has(checked.current.id)||checked.current.status==='partially-applied'&&!acceptance)throw Error('Duplicate or unsupported version');
      if(item.parentId!==null){const parent=seen.get(item.parentId);if(checked.current.origin!=='ai'||parent?.origin!=='ai'||!parent||!sameBasis(parent,checked.current)||!parent.requestId||!checked.current.requestId||parent.requestId===checked.current.requestId)throw Error('Invalid version ancestry');}
      const version={parentId:item.parentId,group:checked.current,checkpoints:checked.checkpoints,acceptance};versions.push(version);seen.set(checked.current.id,checked.current);
    }
    if(input.activeId===null?versions.length||input.operation!==null:!seen.has(input.activeId))throw Error('Invalid active version');
    const result=views({schemaVersion:3,projectId,activeId:input.activeId,versions,operation:input.operation===null?null:clone(input.operation)});
    const chains=new Map();for(const version of versions){const root=chainRoot(version.group.id,result);chains.set(root,(chains.get(root)||0)+1);if(!root||chains.get(root)>MAX_CHAIN_VERSIONS)throw Error('Version chain capacity');}
    return result;
  };
  async function write(value=data,{beforeRename,onCommit}={}) {
    const body=JSON.stringify(value);if(Buffer.byteLength(body)>MAX_BYTES){storage={status:'error',message:STORAGE_ERROR};notify();throw fail('storage-error',STORAGE_ERROR);}
    let renamed=false;storage={status:'saving'};notify();const temporary=join(storageRoot,`.checkpoint-${randomUUID()}.tmp`);
    try{
      await mkdir(storageRoot,{recursive:true,mode:0o700});const info=await lstat(storageRoot);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Unsafe storage');
      const existing=await lstat(filename).catch(caught=>{if(caught.code==='ENOENT')return null;throw caught;});if(existing&&(!existing.isFile()||existing.isSymbolicLink()))throw Error('Unsafe checkpoint');
      const handle=await open(temporary,'wx',0o600);try{await handle.writeFile(body,'utf8');await handle.sync();}finally{await handle.close();}
      if(beforeRename)await beforeRename();
      await rename(temporary,filename);renamed=true;onCommit?.();
      const directory=await open(storageRoot,constants.O_RDONLY|constants.O_NOFOLLOW);try{const directoryInfo=await directory.stat();if(!directoryInfo.isDirectory()||directoryInfo.dev!==info.dev||directoryInfo.ino!==info.ino)throw Error('Storage directory changed before sync');await directory.sync();}finally{await directory.close();}
      storage={status:'saved'};notify();
    }catch(caught){
      if(!renamed&&caught?.name==='ChangeSetError'){storage={status:'saved'};notify();throw caught;}
      const committed=renamed&&Boolean(onCommit),message=committed?SELECTION_SYNC_ERROR:STORAGE_ERROR;
      storage={status:'error',message};notify();throw Object.assign(fail('storage-error',message),{committed});
    }
    finally{await rm(temporary,{force:true}).catch(()=>{});}
  }
  async function checkpoint(){try{await onCheckpoint(clone(data.current));}catch{error='The staged checkpoint is saved, but its conversation history could not be updated.';}}
  async function read() {
    owned();
    try{
      const rootInfo=await lstat(storageRoot).catch(caught=>{if(caught.code==='ENOENT')return null;throw caught;});
      if(rootInfo&&(!rootInfo.isDirectory()||rootInfo.isSymbolicLink()))throw Error('Unsafe storage root');
      const info=rootInfo?await lstat(filename).catch(caught=>{if(caught.code==='ENOENT')return null;throw caught;}):null;
      if(!info){data=empty();loaded=true;storage={status:'saved'};assessment={files:[],canApply:false,canUndo:false,canRecover:false};return;}
      if(!info.isFile()||info.isSymbolicLink()||info.size>MAX_BYTES)throw Error('Invalid storage');
      const handle=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);let body;try{const opened=await handle.stat();if(!opened.isFile()||opened.size>MAX_BYTES)throw Error('Unsafe opened storage');body=await handle.readFile();}finally{await handle.close();}
      if(body.length>MAX_BYTES)throw Error('Large storage');data=validate(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body)));loaded=true;storage={status:'saved'};
      if(data.operation&&data.current.status!=='recovery-required'){advance('recovery-required');await write();}
      if(data.current)await checkpoint();
    }catch(caught){
      if(caught?.code==='storage-error')throw caught;
      loaded=false;data=empty();storage={status:'unavailable',message:UNAVAILABLE};throw fail('storage-unavailable',UNAVAILABLE);
    }
  }
  const unitPaths=(acceptance,ids)=>acceptance.plan.units.filter(unit=>ids.includes(unit.id)).flatMap(unit=>unit.paths);
  const mixedContext=(current,acceptance)=>current.context.map(ref=>({path:ref.path,revision:acceptance&&unitPaths(acceptance,acceptance.appliedUnitIds).includes(ref.path)?hash(current.files.find(file=>file.path===ref.path).after):ref.revision}));
  async function originalSources(current,acceptance){
    const accepted=new Set(acceptance?unitPaths(acceptance,acceptance.appliedUnitIds):[]),files=[];
    for(const ref of current.context){owned();const saved=await getFile(projectId,ref.path);owned();const member=current.files.find(file=>file.path===ref.path),expected=accepted.has(ref.path)?member.after:member?.before;
      if(saved.revision!==(accepted.has(ref.path)?hash(member.after):ref.revision)||expected!==undefined&&saved.source!==expected)throw fail('source-conflict','The complete saved source basis changed. Undo accepted units or prepare a new proposal.');
      files.push({path:ref.path,revision:ref.revision,source:accepted.has(ref.path)?member.before:saved.source});
    }return files;
  }
  async function inspect(state=data,{allowSaving=false}={}) {
    owned();const current=state.current,acceptance=state.acceptance;
    if(!current){const result={files:[],canApply:false,canUndo:false,canRecover:false,canPrepareAcceptance:false,canSelectUnits:false,canClearAcceptance:false};if(state===data)assessment=result;return result;}
    const files=[];let basisFresh=true,basisDirty=false;
    for(const target of current.files){let source;try{source=await getFile(projectId,target.path);}catch{}owned();const dirty=Boolean(await isDirty(target.path));files.push({path:target.path,...(source?{revision:source.revision}:{}),state:!source?'unavailable':source.source===target.before&&source.revision===target.baseRevision?'before':source.source===target.after&&source.revision===hash(target.after)?'after':'conflict',dirty});}
    if(['proposed','partially-applied'].includes(current.status))for(const ref of mixedContext(current,acceptance)){let source;try{source=await getFile(projectId,ref.path);}catch{}owned();if(!source||source.revision!==ref.revision)basisFresh=false;if(await isDirty(ref.path))basisDirty=true;}
    for(const target of files)target.dirty=Boolean(await isDirty(target.path));
    if(['proposed','partially-applied'].includes(current.status))for(const ref of current.context)if(await isDirty(ref.path))basisDirty=true;
    owned();const saved=storage.status==='saved'||allowSaving&&storage.status==='saving',accepted=acceptance?unitPaths(acceptance,acceptance.appliedUnitIds):current.files.map(file=>file.path),selectedPaths=acceptance?unitPaths(acceptance,acceptance.selectedUnitIds):current.files.map(file=>file.path),operationPaths=state.operation?.paths||current.files.map(file=>file.path),undoFiles=files.filter(file=>accepted.includes(file.path)),recoveryFiles=files.filter(file=>operationPaths.includes(file.path));
    const applyClean=files.every(item=>!item.dirty)&&!basisDirty,undoClean=undoFiles.every(item=>!item.dirty),recoverClean=recoveryFiles.every(item=>!item.dirty);
    const expectedSides=files.every(item=>item.state===(acceptance&&accepted.includes(item.path)?'after':'before'));
    const result={files,canApply:saved&&['proposed','partially-applied'].includes(current.status)&&selectedPaths.length>0&&applyClean&&expectedSides&&basisFresh,
      canUndo:saved&&['applied','partially-applied'].includes(current.status)&&undoFiles.length>0&&undoClean&&undoFiles.every(item=>item.state==='after'),
      canRecover:saved&&current.status==='recovery-required'&&Boolean(state.operation)&&recoverClean&&recoveryFiles.every(item=>['before','after'].includes(item.state)),
      canPrepareAcceptance:saved&&current.origin==='ai'&&current.status==='proposed'&&!acceptance&&applyClean&&expectedSides&&basisFresh,
      canSelectUnits:saved&&Boolean(acceptance)&&['proposed','partially-applied'].includes(current.status)&&!state.operation,
      canClearAcceptance:saved&&Boolean(acceptance)&&current.status==='proposed'&&!acceptance.appliedUnitIds.length&&!state.operation,
      ...(state.operation?{operationPaths:[...operationPaths]}:{})};
    const relevant=current.status==='recovery-required'?recoveryFiles:['applied','partially-applied'].includes(current.status)&&!basisFresh?undoFiles:files;
    if(!saved)result.reason=STORAGE_ERROR;
    else if(current.status==='recovery-required')result.reason=!recoverClean?'Resolve drafts in the interrupted operation before recovery.':recoveryFiles.some(item=>!['before','after'].includes(item.state))?'An operation target changed. Foundation will not overwrite unknown source.':'Recover restores only this interrupted operation to its prior accepted scope.';
    else if(relevant.some(item=>item.state==='conflict'||item.state==='unavailable'))result.reason='A target changed or is unavailable. Foundation will not overwrite unknown source.';
    else if(!applyClean)result.reason='Resolve affected native editor drafts before applying. Undo affects accepted units only.';
    else if(['proposed','partially-applied'].includes(current.status)&&!basisFresh)result.reason='The complete original source context changed. Undo accepted units or prepare a new proposal.';
    else if(acceptance&&!selectedPaths.length&&current.status!=='applied')result.reason='Choose at least one pending unit to apply.';
    if(state===data)assessment=result;return result;
  }
  const selected=(id,revision)=>{
    available();if(!data.current||data.current.id!==id||!Number.isSafeInteger(revision)||revision!==data.current.revision)throw fail('change-set-changed','The change set changed. Review its current revision before continuing.');return data.current;
  };
  const advance=status=>{data.current.status=status;data.current.revision++;data.current.updatedAt=new Date().toISOString();};
  const record=kind=>{if(data.checkpoints.length>=32)throw fail('checkpoint-capacity','The checkpoint history is full; existing records have been preserved.');data.checkpoints.push({id:randomUUID(),kind,createdAt:new Date().toISOString()});};
  async function perform(kind,id,revision){
    const current=selected(id,revision);await inspect();
    if(!(kind==='apply'?assessment.canApply:kind==='undo'?assessment.canUndo:assessment.canRecover))throw fail('source-conflict',assessment.reason||'This operation is unavailable for the current source.');
    if(data.checkpoints.length>=32||data.checkpoints.length>=31&&kind!=='recover')throw fail('checkpoint-capacity','The checkpoint history is full. Existing records are preserved.');
    const acceptance=data.acceptance;
    if(kind==='apply'&&current.alternativeBasis){
      let valid=false;try{valid=await validateAlternative(clone(current.alternativeBasis),{phase:'apply',group:clone(current)})===true;}catch{}
      owned();if(!valid)throw fail('alternative-stale','The retained alternative or its original baseline changed. Review a current candidate before applying.');
      await inspect();if(!assessment.canApply)throw fail('source-conflict',assessment.reason||'The source changed while validating its retained alternative.');
    }
    if(kind==='apply'&&acceptance){const fresh=createAcceptancePlan({group:current,files:await originalSources(current,acceptance)});owned();if(JSON.stringify(fresh)!==JSON.stringify(acceptance.plan))throw fail('source-conflict','Acceptance units changed. Prepare the whole proposal again.');}
    const originalOperation=clone(data.operation),priorApplied=acceptance?[...acceptance.appliedUnitIds]:null;
    const targetApplied=acceptance?(kind==='apply'?orderedIds(acceptance.plan,[...priorApplied,...acceptance.selectedUnitIds]):kind==='undo'?[]:[...originalOperation.priorAppliedUnitIds]):null;
    const paths=acceptance?(kind==='apply'?unitPaths(acceptance,acceptance.selectedUnitIds):kind==='undo'?unitPaths(acceptance,priorApplied):[...originalOperation.paths]):current.files.map(file=>file.path);
    const destinationFor=path=>kind==='recover'&&acceptance?(unitPaths(acceptance,targetApplied).includes(path)?'after':'before'):kind==='apply'?'after':kind==='undo'?'before':originalOperation.recoveryTarget;
    const recoveryTarget=kind==='apply'?'before':kind==='undo'?'after':originalOperation.recoveryTarget,beforeStatus=current.status;
    const refs=current.files.filter(file=>paths.includes(file.path)).map(file=>({path:file.path,revision:assessment.files.find(item=>item.path===file.path).revision}));
    const files=current.files.filter(file=>paths.includes(file.path)&&assessment.files.find(item=>item.path===file.path).state!==destinationFor(file.path)).map(file=>{const state=assessment.files.find(item=>item.path===file.path).state;return {path:file.path,before:file[state],after:file[destinationFor(file.path)],baseRevision:hash(file[state])};});
    data.operation=kind==='recover'?{...originalOperation,kind:'recover',writtenPaths:[]}:{groupId:current.id,id:randomUUID(),kind,startedAt:new Date().toISOString(),recoveryTarget,writtenPaths:[],...(acceptance?{paths:[...paths],priorAppliedUnitIds:[...priorApplied],targetAppliedUnitIds:[...targetApplied],priorSelectedUnitIds:[...acceptance.selectedUnitIds]}:{})};
    advance(kind==='undo'?'undoing':kind==='apply'?'applying':'recovery-required');
    try{await write();}catch(caught){advance('recovery-required');await inspect().catch(()=>{});throw caught;}
    const dirtyPaths=kind==='apply'?current.context.map(item=>item.path):paths;
    const guard=async(context={})=>{owned();for(const path of dirtyPaths)if(await isDirty(path))throw fail('dirty-source','A source used by this operation has an unsaved draft.');owned();
      if(kind==='apply'&&current.alternativeBasis&&['before-write','complete'].includes(context.originalBatchWrite?.phase)){
        let valid=false;try{valid=await validateAlternative(clone(current.alternativeBasis),{phase:'progress',group:clone(current),originalBatchWrite:clone(context.originalBatchWrite)})===true;}catch{}
        owned();if(!valid)throw fail('alternative-stale','The retained baseline changed during Apply. Inspect the source and recover the interrupted group.');
        for(const path of dirtyPaths)if(await isDirty(path))throw fail('dirty-source','A source used by this operation acquired an unsaved draft.');owned();
      }return true;};
    try{
      if(files.length)await applyBatch({projectId,files,expectedContext:kind==='apply'?mixedContext(current,acceptance):refs},{guard,journal:async event=>{owned();if(!['prepared','before-write','after-write','complete'].includes(event.type)||!Array.isArray(event.writtenPaths)||new Set(event.writtenPaths).size!==event.writtenPaths.length||event.writtenPaths.some(path=>!files.some(file=>file.path===path))||data.operation.writtenPaths.some(path=>!event.writtenPaths.includes(path)))throw fail('invalid-journal','The change-set journal was invalid.');data.operation.writtenPaths=[...event.writtenPaths];await write();}});
      await guard();
      const operation=clone(data.operation),priorCheckpoints=clone(data.checkpoints),priorAcceptance=clone(acceptance);
      if(acceptance){acceptance.appliedUnitIds=[...targetApplied];acceptance.selectedUnitIds=kind==='recover'?[...operation.priorSelectedUnitIds]:[];for(const file of current.files){if(unitPaths(acceptance,targetApplied).includes(file.path))file.appliedRevision=hash(file.after);else if(kind!=='undo')delete file.appliedRevision;}}
      else if(destinationFor(current.files[0].path)==='after')for(const file of current.files)file.appliedRevision=hash(file.after);
      const status=acceptance?targetApplied.length===acceptance.plan.units.length?'applied':targetApplied.length?'partially-applied':kind==='undo'?'undone':'proposed':kind==='recover'?(destinationFor(current.files[0].path)==='after'?'applied':'proposed'):kind==='apply'?'applied':'undone';
      advance(status);data.operation=null;record(kind==='recover'?'recovered':kind==='apply'?'applied':'undone');
      try{await write();}catch(caught){data.checkpoints=priorCheckpoints;data.operation=operation;if(acceptance)data.acceptance=priorAcceptance;advance('recovery-required');throw caught;}
      await inspect();await checkpoint();return snapshot();
    }catch(caught){
      if(!data.operation)throw caught;
      if(Array.isArray(caught?.writtenPaths)&&caught.writtenPaths.length===0&&storage.status!=='error'&&kind!=='recover'){data.operation=null;advance(beforeStatus);}else advance('recovery-required');
      if(storage.status!=='error')await write().catch(()=>{});await inspect().catch(()=>{});await checkpoint();
      throw caught?.code==='storage-error'?caught:fail('change-set-incomplete','The operation stopped. Inspect the source states and use explicit recovery if available.');
    }
  }
  const requestOwned=isCurrent=>{owned();if(!isCurrent())throw fail('operation-retired','The checkpoint selection was cancelled before it became available.');};
  async function commitSelection(next,isCurrent){
    if(Buffer.byteLength(JSON.stringify(next))>MAX_BYTES)throw fail('checkpoint-capacity','The retained version history is full. Existing versions have been preserved.');
    requestOwned(isCurrent);let final=await inspect(next);requestOwned(isCurrent);
    if(!final.canApply)throw fail('source-conflict',final.reason||'The complete original source must be fresh before changing versions.');
    await write(next,{
      beforeRename:async()=>{
        // All asynchronous source and cancellation checks precede the commit.
        // The complete temporary envelope is already synced at this point.
        requestOwned(isCurrent);final=await inspect(next,{allowSaving:true});requestOwned(isCurrent);
        if(!final.canApply)throw fail('source-conflict',final.reason||'The original source changed while saving this version.');
      },
      onCommit:()=>{
        // Atomic rename is the selection commit point. A later cancellation
        // cannot undo this completed selection. A directory-sync failure keeps
        // this visible selection blocked on Retry; it never silently promotes
        // a candidate that was hidden in memory.
        data=next;assessment=final;notify();
      },
    });
    await checkpoint();
  }
  const api={snapshot,isBusy:()=>busy,ownershipToken,
    load:()=>loaded?Promise.resolve(snapshot()):action(async()=>{await read();await inspect();}),
    stage:(input,{isCurrent:requestCurrent=()=>true}={})=>action(async()=>{
      available();if(!requestCurrent())throw fail('operation-retired','The staged response was cancelled.');
      if(data.current&&!['discarded','undone'].includes(data.current.status))throw fail('checkpoint-active','Undo, recover, or dismiss the current checkpoint before staging another change set.');
      const current=validateChangeSet(input,projectId);if(current.id===data.current?.id||current.status!=='proposed'||current.revision!==0||current.files.some(file=>file.baseRevision!==hash(file.before)||file.appliedRevision!==undefined))throw fail('invalid-change-set','Stage a newly validated source change set.');
      if(data.versions.length>=MAX_VERSIONS)throw fail('checkpoint-capacity','The 64-version local history is full. Existing versions have been preserved.');
      if(data.versions.some(item=>item.group.id===current.id))throw fail('invalid-change-set','This source version identity is already retained.');
      const previous=copyData(data),now=new Date().toISOString();data=copyData(data);data.activeId=current.id;data.operation=null;data.versions.push({parentId:null,group:{...current,createdAt:now,updatedAt:now},checkpoints:[],acceptance:null});record('staged');
      assessment={files:[],canApply:false,canUndo:false,canRecover:false};
      await write();
      const requestOwned=()=>requestCurrent()&&isCurrent()&&!disposed;
      try{
        if(!requestOwned())throw fail('operation-retired','The staged response was cancelled.');
        await inspect();
        if(!requestOwned())throw fail('operation-retired','The staged response was cancelled.');
        await checkpoint();
        if(!requestOwned())throw fail('operation-retired','The staged response was cancelled.');
      }catch(caught){
        if(!requestOwned()){data=previous;await write();await inspect().catch(()=>{});throw fail('operation-retired','The staged response was cancelled before it became available.');}
        throw caught;
      }
    }),
    refine:(input,{parentId,expectedParentRevision,parentDigest,isCurrent:requestCurrent=()=>true}={})=>action(async()=>{
      const parent=selected(parentId,expectedParentRevision);requestOwned(requestCurrent);
      if(parent.origin!=='ai'||parent.status!=='proposed'||data.acceptance||data.operation||parentDigest!==changeGroupDigest(parent))throw fail('change-set-changed','Refine the exact current staged version.');
      if(data.versions.length>=MAX_VERSIONS)throw fail('checkpoint-capacity','The 64-version local history is full. Existing versions have been preserved.');
      const root=chainRoot(parent.id);if(data.versions.filter(item=>chainRoot(item.group.id)===root).length>=MAX_CHAIN_VERSIONS)throw fail('checkpoint-capacity','This refinement chain already retains eight versions. Earlier versions have been preserved.');
      await inspect();requestOwned(requestCurrent);
      if(!assessment.canApply)throw fail('source-conflict',assessment.reason||'The original source must be fresh before refining.');
      const group=validateChangeSet(input,projectId);
      if(group.status!=='proposed'||group.revision!==0||data.versions.some(item=>item.group.id===group.id)||group.files.some(file=>file.appliedRevision!==undefined)||
        !parent.requestId||!group.requestId||parent.requestId===group.requestId||!sameBasis(parent,group))throw fail('invalid-change-set','A refinement needs a new request and version with the same original source basis.');
      const at=new Date().toISOString(),next=copyData(data);next.activeId=group.id;
      next.versions.push({parentId:parent.id,group:{...group,createdAt:at,updatedAt:at},checkpoints:[{id:randomUUID(),kind:'staged',createdAt:at}],acceptance:null});
      await commitSelection(next,requestCurrent);
    }),
    activateVersion:(id,{expectedCurrentId,expectedCurrentRevision,isCurrent:requestCurrent=()=>true}={})=>action(async()=>{
      const current=selected(expectedCurrentId,expectedCurrentRevision);requestOwned(requestCurrent);
      const target=data.versions.find(item=>item.group.id===id)?.group;
      if(current.origin!=='ai'||target?.origin!=='ai'||data.acceptance||data.versions.find(item=>item.group.id===id)?.acceptance||!target||target.id===current.id||chainRoot(target.id)!==chainRoot(current.id)||current.status!=='proposed'||target.status!=='proposed'||data.operation)
        throw fail('version-unavailable','Choose a retained staged version while the current version is still unapplied.');
      await inspect();requestOwned(requestCurrent);
      if(!assessment.canApply)throw fail('source-conflict',assessment.reason||'The current original source must be fresh before changing versions.');
      const next=copyData(data);next.activeId=target.id;next.current.revision++;next.current.updatedAt=new Date().toISOString();
      await commitSelection(next,requestCurrent);
    }),
    prepareAcceptance:(id,revision)=>action(async()=>{
      const group=selected(id,revision);await inspect();if(!assessment.canPrepareAcceptance)throw fail('acceptance-unavailable',assessment.reason||'Prepare acceptance from an unapplied whole proposal.');
      const basis=await originalSources(group,null),plan=createAcceptancePlan({group,files:basis}),next=copyData(data);owned();
      next.acceptance={plan,selectedUnitIds:plan.units.map(unit=>unit.id),appliedUnitIds:[],basis};for(const file of next.current.files)delete file.appliedRevision;next.current.revision++;next.current.updatedAt=new Date().toISOString();await commitSelection(next,()=>true);
    }),
    selectUnits:(id,revision,{planDigest,unitIds}={})=>action(async()=>{
      selected(id,revision);await inspect();if(!assessment.canSelectUnits||planDigest!==data.acceptance?.plan.digest)throw fail('acceptance-changed','Review the current acceptance units before selecting.');
      let ids;try{ids=orderedIds(data.acceptance.plan,unitIds);}catch{throw fail('invalid-selection','Select complete pending acceptance units only.');}if(ids.some(id=>data.acceptance.appliedUnitIds.includes(id)))throw fail('invalid-selection','Already accepted units cannot be selected again.');
      if(JSON.stringify(ids)===JSON.stringify(data.acceptance.selectedUnitIds))return;
      const next=copyData(data);next.acceptance.selectedUnitIds=ids;next.current.revision++;next.current.updatedAt=new Date().toISOString();
      await write(next,{beforeRename:async()=>{owned();},onCommit:()=>{data=next;notify();}});await inspect();await checkpoint();
    }),
    clearAcceptance:(id,revision)=>action(async()=>{
      selected(id,revision);await inspect();if(!assessment.canClearAcceptance)throw fail('acceptance-active','Undo accepted units before replacing their scope.');
      const next=copyData(data);next.acceptance=null;next.current.revision++;next.current.updatedAt=new Date().toISOString();await write(next,{beforeRename:async()=>{owned();},onCommit:()=>{data=next;notify();}});await inspect();await checkpoint();
    }),
    assess:async()=>{
      if(busy)return snapshot();
      // Loaded empty storage has no source work to assess. Publishing a busy
      // operation here would briefly disable unrelated Assistant controls.
      // Keep ownership checks and all error/recovery paths; real groups still
      // use the operation lock while reading and validating their source.
      if(loaded && storage.status==='saved' && !error && !data.current){available();return snapshot();}
      return action(async()=>{available();await inspect();return snapshot();});
    },
    apply:(id,revision)=>action(()=>perform('apply',id,revision)),
    undo:(id,revision)=>action(()=>perform('undo',id,revision)),
    recover:(id,revision)=>action(()=>perform('recover',id,revision)),
    discard:(id,revision)=>action(async()=>{selected(id,revision);if(data.operation)throw fail('recovery-required','Recover the interrupted operation before dismissing its checkpoint.');advance('discarded');await write();await inspect();await checkpoint();return snapshot();}),
    retry:()=>action(async()=>{owned();if(!loaded||storage.status==='unavailable')await read();else {if(data.operation&&data.current.status!=='recovery-required')advance('recovery-required');await write();}await inspect();await checkpoint();}),
    dispose:()=>{disposed=true;},
  };
  return api;
}
