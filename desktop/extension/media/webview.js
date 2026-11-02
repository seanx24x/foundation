(() => {
  "use strict";
  const vscode = acquireVsCodeApi();
  const persisted = vscode.getState() || {};
  const workspace = window.FoundationWorkspace;
  const historyReceiver = window.FoundationHistory?.createReceiver();
  const normalizeIntent=window.FoundationArtifacts.normalizeIntent;
  const assistantSurface = document.body.dataset.foundationSurface === "assistant";
  const externalAssistant = document.body.dataset.foundationAssistant === "external";
  const managesAssistantContext=assistantSurface || !externalAssistant;
  const hasPersistedAssistantContext=managesAssistantContext && Object.hasOwn(persisted,"assistantContext");
  const persistedAssistantContext=hasPersistedAssistantContext ? validateAssistantContext(persisted.assistantContext) : null;
  const persistedRevisionInvalid=Boolean(persistedAssistantContext && persisted.assistantContext?.requestRevision!==undefined && !persistedAssistantContext.requestRevision);
  const persistedGroupRevisionInvalid=Boolean(persistedAssistantContext && persisted.assistantContext?.groupRevision!==undefined && !persistedAssistantContext.groupRevision);
  const persistedCheckContextInvalid=Boolean(persistedAssistantContext && persisted.assistantContext?.checkContext!==undefined && !persistedAssistantContext.checkContext);
  const persistedInvestigationInvalid=Boolean(persistedAssistantContext && persisted.assistantContext?.sourceInvestigation!==undefined && !persistedAssistantContext.sourceInvestigation);
  const persistedContinuationInvalid=Boolean(persistedAssistantContext && persisted.assistantContext?.investigationContext!==undefined && !persistedAssistantContext.investigationContext);
  const persistedQuestion=typeof persisted.question==="string" && persisted.question.length<=6000 ? persisted.question : "";
  let pendingAssistantRestore=persistedAssistantContext ? {context:persistedAssistantContext,question:persistedQuestion,intent:normalizeIntent(persisted.intent),revisionInvalid:persistedRevisionInvalid,groupRevisionInvalid:persistedGroupRevisionInvalid,checkContextInvalid:persistedCheckContextInvalid,investigationInvalid:persistedInvestigationInvalid,continuationInvalid:persistedContinuationInvalid} : null;
  let coldAssistantContextResolved=!hasPersistedAssistantContext;
  let assistantDraftEdited=false,assistantFeatureHydrated=false,assistantRestoreRequest=null;
  const modes = ["Understand", "Refine", "Review", "Assistant"];
  const state = {
    mode: assistantSurface ? "Assistant" : modes.includes(persisted.mode) && !(externalAssistant && persisted.mode === "Assistant") ? persisted.mode : "Understand",
    assistantSurface: null,
    sidebarContextOpen: persisted.sidebarContextOpen === true,
    project: null,
    focus: null,
    layouts: workspace.normalizeLayouts(persisted.layouts),
    inspectorOpen: false,
    activeFile: null,
    openFiles: [],
    dirtyPaths: [],
    changes: [],
    selection: null,
    trusted: false,
    provider: null,
    error: "",
    status: "",
    connected: false,
    context: [],
    contextInitialized: false,
    contextRestoreLoading: false,
    contextUnavailable: [],
    assistantContextFiles: [],
    question: hasPersistedAssistantContext ? "" : persistedQuestion,
    turns: [],
    conversations: null,
    historyOpen: false,
    historyAction: null,
    historyFocus: false,
    pendingRequestId: null,
    running: false,
    sourceExpanded: false,
    lastProject: null,
    intent: !hasPersistedAssistantContext ? normalizeIntent(persisted.intent) : "ask",
    planContext:null,
    requestRevision:null,
    requestRevisionNotice:"",
    groupRevision:null,
    groupRevisionNotice:"",
    checkContext:null,
    checkContextNotice:"",
    investigationContext:null,
    sourceInvestigation:null,
    investigationRefreshed:false,
    investigationNotice:"",
    continuationContext:null,
    continuationRefreshed:false,
    continuationNotice:"",
    investigationContinuation:null,
    artifactSourceFiles:[],
    artifactSourceUnavailable:[],
    design: null,
    designImpact: null,
    visualVerification: null,
    visualAlternatives: null,
    aiAlternatives: null,
    alternativeGenerationDraft: null,
    projectDecisions: null,
    decisionContext: [],
    reproducibleIssues: null,
    issueContext: [],
    runtime: null,
    runtimeWorkspace: null,
    runtimeCaptures: null,
    runtimeReplays: null,
    runtimeMatrices: null,
    runtimeStateSuites: null,
    runtimeEditor: null,
    features: null,
    featureFiles: [],
    featureLoading: false,
    featureCandidates: [],
    featureRelationships: null,
    featureUnavailable: [],
    featureTaskIncluded: false,
    featureCreateOpen: false,
    previewMode: persisted.previewMode === "runtime" ? "runtime" : "sandbox",
    runtimeTargetId: "",
    runtimeUrlDraft: "",
    runtimeObservationIds: [],
    proposal: null,
    changeSetSession:null,
    executionSession:null,
    designEntry: "",
    designWidth: persisted.designWidth || "960",
    designTheme: persisted.designTheme || "light",
    designInspect: true,
    designFit: true,
    pendingDesignContext: null,
    designSelection: undefined,
    unmappedMessage: "",
    tokenDrafts: {},
    tokenInputs: {},
    selectedToken: null,
    tokenFilter: "",
    skippedExperiments: 0,
  };
  const root =
    document.getElementById("foundation-root") ||
    document.getElementById("app") ||
    document.body;
  let composer = null;
  let responseRegion = null;
  let turnCounter = 0;
  let designFrame = null;
  let renderedPreviewMode = null;
  let renderedRuntimeURL = null;
  let renderedRuntimeViewId = null;
  let renderedDesignSession = null;
  let renderedDesignProject = null;
  let designSettingsSignature = "";
  let designResizeObserver = null;
  let renderedTokenEditorKey = "";
  let refreshTokenEditor = null;
  let chromeSlot, mainSurface, designSlot, alternativesSlot, otherSlot, footerSlot;
  let layoutObserver = null;
  let inspectorDrag = null;
  const scrollPositions = new Map();
  const hydratedLayouts = new Set();
  const conversationDrafts = new Map();
  const ephemeralTurns = new Map();
  const featureDrafts = new Map(Array.isArray(persisted.featureDrafts) ? persisted.featureDrafts.filter(item => Array.isArray(item) && typeof item[0] === "string" && item[1] && typeof item[1].title === "string" && typeof item[1].brief === "string" && Array.isArray(item[1].paths) && typeof item[1].base === "string") : []);
  let pendingFeatureCreate = null;
  const runtimeDefinitionDrafts = new Map(Array.isArray(persisted.runtimeDefinitionDrafts) ? persisted.runtimeDefinitionDrafts.filter(item=>Array.isArray(item) && typeof item[0]==="string" && item[1] && typeof item[1].title==="string" && typeof item[1].base==="string") : []);
  const manualRunDrafts = new Map(Array.isArray(persisted.manualRunDrafts) ? persisted.manualRunDrafts.filter(item=>Array.isArray(item) && typeof item[0]==="string" && item[1] && typeof item[1].note==="string") : []);
  const runtimeCaptureImages = new Map();
  const replayChoices = new Map((Array.isArray(persisted.replayChoices)?persisted.replayChoices.slice(-40):[]).map(safeReplayChoice).filter(Boolean).map(value=>[JSON.stringify([value.projectId,value.featureId,value.screenId,value.runId]),value]));
  let pendingReplayStart=null,pendingReplayCancel=null;
  const matrixDrafts=new Map((Array.isArray(persisted.matrixDrafts)?persisted.matrixDrafts.slice(-16):[]).map(safeMatrixDraft).filter(Boolean).map(value=>[JSON.stringify([value.projectId,value.featureId,value.screenId,value.scenarioId]),value]));
  const suiteDrafts=new Map((Array.isArray(persisted.suiteDrafts)?persisted.suiteDrafts.slice(-16):[]).map(safeSuiteDraft).filter(Boolean).map(value=>[JSON.stringify([value.projectId,value.featureId,value.screenId,value.scenarioId]),value]));
  let pendingSuiteSave=null;
  let pendingMatrixStart=null,pendingMatrixCancel=null,matrixPreviewHint=null,matrixPreviewAcknowledgment=null,lastMatrixId=null;
  const observationComparisons = new Map((Array.isArray(persisted.observationComparisons) ? persisted.observationComparisons.slice(-16) : []).map(safeObservationComparison).filter(Boolean).map(pair => [JSON.stringify([pair.projectId,pair.featureId]),pair]));
  const visualVerificationDrafts = new Map((Array.isArray(persisted.visualVerificationDrafts) ? persisted.visualVerificationDrafts.slice(-16) : []).map(safeVisualVerificationDraft).filter(Boolean).map(value => [visualVerificationDraftKey(value),value]));
  let pendingVisualVerificationLink=null,pendingVisualVerificationNavigation=null;
  let visualVerificationConfirmation=null,pendingVisualVerificationReveal=null;
  const alternativeDrafts = new Map((Array.isArray(persisted.visualAlternativesDrafts) ? persisted.visualAlternativesDrafts.slice(-16) : []).map(safeAlternativeDraft).filter(Boolean).map(value=>[alternativeDraftKey(value),value]));
  const alternativeDisclosures = new Map((Array.isArray(persisted.visualAlternativeDisclosures)?persisted.visualAlternativeDisclosures.slice(-80):[]).filter(value=>value && typeof value.projectId==="string" && value.projectId.length<=200 && typeof value.key==="string" && value.key.startsWith("alternatives/") && value.key.length<=1000 && typeof value.open==="boolean").map(value=>[JSON.stringify([value.projectId,value.key]),value]));
  const alternativeComparisons = new Map((Array.isArray(persisted.visualAlternativeComparisons)?persisted.visualAlternativeComparisons.slice(-16):[]).map(safeAlternativeComparison).filter(Boolean).map(value=>[value.projectId,value]));
  const decisionDrafts = new Map((Array.isArray(persisted.decisionDrafts)?persisted.decisionDrafts.slice(-16):[]).map(safeDecisionDraft).filter(Boolean).map(value=>[decisionDraftKey(value),value]));
  let pendingDecisionAction=null,pendingDecisionComparison=null;
  const issueDrafts=new Map((Array.isArray(persisted.issueDrafts)?persisted.issueDrafts.slice(-16):[]).map(safeIssueDraft).filter(Boolean).map(value=>[issueDraftKey(value),value]));
  let pendingIssueAction=null,pendingIssueEvidence=null,pendingIssueReveal=null,issueCaptureSelection=null;
  const alternativeReviewFeedback = new Map();
  let pendingAlternativeComparison=null,alternativeComparisonError=null;
  const alternativeImages = new Map();
  let pendingAlternativeAction=null, pendingAlternativeReveal=null, alternativeImageOwner=null;
  let alternativeFrame=null, alternativeFrameKey=null, alternativePreviewHint=null, alternativeWitness=null, alternativeAcknowledgment=null, alternativeWitnessTimer=null;
  let alternativeResizeObserver=null;
  let pendingRuntimeDefinition = null;
  const planDrafts=new Map(),restoredPlanDrafts=new Set();
  const persistedPlanDrafts=(Array.isArray(persisted.planDrafts)?persisted.planDrafts.slice(-16):[]).map(safePlanDraftRecord).filter(Boolean);
  const planSelections=new Map(),planVersions=new Map(),planErrors=new Map();
  const changeSetSelections=new Map();
  let pendingAcceptanceAction=null;
  const executionTaskSelections=new Map();
  const checkPlanTaskSelections=new Map();
  const checkPlanSelectedIds=new Map();
  const checkSuggestionDrafts=new Map((Array.isArray(persisted.checkSuggestionDrafts)?persisted.checkSuggestionDrafts.slice(-16):[]).map(safeCheckSuggestionDraft).filter(Boolean));
  const checkSuggestionErrors=new Map();
  let pendingCheckSuggestion=null,pendingCheckDecision=null;
  let pendingSourceInvestigation=null,pendingContinuation=null,pendingContinuationAction=null;
  const continuationErrors=new Map();
  const executionOutputScroll=new Map();
  let pendingPlanAction=null,pendingPlanPreparation=null;
  let pendingRequestRevision=null,assistantDraftGeneration=0;
  const requestRevisionErrors=new Map();
  let pendingGroupRevision=null;
  const groupRevisionErrors=new Map();
  let pendingAIAlternative=null;
  let knowledgeState=null,knowledgeCache=null,pendingKnowledgeContext=null,knowledgeNotice="",knowledgeFocusSearch=false;
  let knowledgeOpenProjectId=typeof persisted.knowledgeOpenProjectId==="string"?persisted.knowledgeOpenProjectId:null;
  const appliedKnowledgeOffers=new Set();
  const iconPaths = {
    source: "M5 3h9l5 5v13H5z M14 3v6h5 M9 13l-2 2 2 2 M15 13l2 2-2 2",
    history: "M3 11a9 9 0 1 1 2 7 M3 4v7h7 M12 7v5l3 2",
    plus: "M12 5v14 M5 12h14",
    archive: "M3 4h18v5H3z M5 9v11h14V9 M9 13h6",
    graph:
      "M12 4v5 M5 18v-5h14v5 M12 13v5 M9 1h6v6H9z M2 18h6v5H2z M9 18h6v5H9z M16 18h6v5h-6z",
    arrow: "M5 12h14 M14 7l5 5-5 5",
    external: "M8 5H4v15h15v-4 M12 4h8v8 M20 4L9 15",
    check: "M5 12l4 4L19 6",
    review: "M8 3H4v18h16V3h-4 M8 2h8v4H8z M8 11l2 2 5-5 M8 17h8",
    inspect: "M5 3l14 10-7 1-3 7z",
    spark: "M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z",
    folder: "M3 5h6l2 3h10v12H3z",
    refresh: "M20 10a8 8 0 1 0-1 7 M20 3v7h-7",
    terminal: "M4 6l5 6-5 6 M12 18h8",
    search: "M15 15l6 6 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
    debug: "M8 6h8v14H8z M10 2h4 M4 9h4 M16 9h4 M4 15h4 M16 15h4",
    branch:
      "M6 7v10 M18 7a6 6 0 0 1-6 6H6 M6 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4 M18 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4 M6 17a2 2 0 1 1 0 4 2 2 0 0 1 0-4",
    close: "M6 6l12 12 M18 6L6 18",
    sidebar: "M3 4h18v16H3z M15 4v16 M7 9l3 3-3 3",
    shield: "M12 2l8 3v7c0 5-8 10-8 10S4 17 4 12V5z M8 11l3 3 5-6",
    chevron: "M9 5l7 7-7 7",
    stop: "M6 6h12v12H6z",
    send: "M12 20V4 M5 11l7-7 7 7",
    color:
      "M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h5c4 0 3-10-6-10z M7 8h.1 M11 6h.1 M16 8h.1 M6 13h.1",
    code: "M8 6l-6 6 6 6 M16 6l6 6-6 6 M14 3l-4 18",
  };
  function el(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  }
  function icon(name, size = 16) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.5");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", iconPaths[name] || iconPaths.source);
    svg.append(path);
    return svg;
  }
  function button(label, handler, className = "button", glyph) {
    const b = el("button", className);
    b.type = "button";
    if (glyph) b.append(icon(glyph));
    b.append(el("span", "", label));
    b.addEventListener("click", handler);
    return b;
  }
  function action(id) {
    vscode.postMessage({ type: "action", id });
  }
  function navigate(path, line = 1) {
    vscode.postMessage({ type: "navigate", path, line });
  }
  function basename(path) {
    return path?.split("/").pop() || "Source";
  }
  function pathParent(path) {
    return path.includes("/")
      ? path.slice(0, path.lastIndexOf("/"))
      : "Project root";
  }
  function byteLength(value) {
    return new TextEncoder().encode(value).length;
  }
  function formatBytes(value) {
    return value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KiB`;
  }
  function validAssistantIdentity(value, nullable=false) {
    return nullable && value===null || typeof value==="string" && value.length>0 && value.length<=160 && !/[\u0000-\u001f\u007f]/.test(value);
  }
  function validContextPath(path) {
    return typeof path==="string" && path.length>0 && path.length<=1024 && !path.startsWith("/") && !/^[A-Za-z]:/.test(path) && !/[\\\u0000-\u001f\u007f]/.test(path) && !path.split("/").some(part=>!part || part==="." || part==="..");
  }
  function validateAssistantContext(value) {
    if(!value || typeof value!=="object" || Array.isArray(value) || value.version!==1)return null;
    const allowed=new Set(["version","projectId","featureId","conversationId","initialized","paths","includeTaskBrief","planContext","requestRevision","groupRevision","checkContext","sourceInvestigation","investigationContext","decisionContext","issueContext","alternativeGenerationDraft"]);
    if(Object.keys(value).some(key=>!allowed.has(key)) || !validAssistantIdentity(value.projectId) || !validAssistantIdentity(value.featureId,true) || !validAssistantIdentity(value.conversationId,true) || typeof value.initialized!=="boolean" || typeof value.includeTaskBrief!=="boolean" || value.includeTaskBrief && value.featureId===null || !Array.isArray(value.paths) || value.paths.length>32 || value.paths.some(path=>!validContextPath(path)) || new Set(value.paths).size!==value.paths.length || !value.initialized && (value.paths.length>0 || value.includeTaskBrief))return null;
    if(value.decisionContext!==undefined&&!validDecisionSelections(value.decisionContext))return null;
    if(value.issueContext!==undefined&&!validIssueSelections(value.issueContext))return null;
    const alternativeGenerationDraft=value.alternativeGenerationDraft===undefined?null:validateAlternativeDraft(value.alternativeGenerationDraft);
    if(value.alternativeGenerationDraft!==undefined&&!alternativeGenerationDraft)return null;
    const planContext=value.planContext===undefined?null:validatePlanDescriptor(value.planContext);
    if(value.planContext!==undefined && (!planContext || planContext.conversationId!==value.conversationId))return null;
    const candidate=value.requestRevision===undefined?null:validateRequestRevision(value.requestRevision);
    const requestRevision=candidate && candidate.conversationId===value.conversationId && !planContext && value.initialized ? candidate : null;
    const groupCandidate=value.groupRevision===undefined?null:validateGroupRevision(value.groupRevision);
    const groupRevision=groupCandidate && groupCandidate.conversationId===value.conversationId && !planContext && !requestRevision && value.initialized?groupCandidate:null;
    const checkCandidate=value.checkContext===undefined?null:validateCheckContext(value.checkContext);
    const checkContext=checkCandidate && checkCandidate.conversationId===value.conversationId && !planContext && !requestRevision && !groupRevision && !value.includeTaskBrief && value.initialized?checkCandidate:null;
    const investigationCandidate=value.sourceInvestigation===undefined?null:window.FoundationArtifacts.sourceInvestigationSnapshot(value.sourceInvestigation);
    const sourceInvestigation=investigationCandidate && investigationCandidate.projectId===value.projectId && investigationCandidate.featureId===value.featureId && !planContext && !requestRevision && !groupRevision && !checkContext && !value.includeTaskBrief && value.initialized && value.paths.length===1 && value.paths[0]===investigationCandidate.anchor.path?investigationCandidate:null;
    const continuationCandidate=value.investigationContext===undefined?null:window.FoundationArtifacts.investigationContextSnapshot(value.investigationContext);
    const investigationContext=continuationCandidate && continuationCandidate.conversationId===value.conversationId && continuationCandidate.result.projectId===value.projectId && continuationCandidate.result.featureId===value.featureId && !planContext && !requestRevision && !groupRevision && !checkContext && !sourceInvestigation && !value.includeTaskBrief && value.initialized && value.paths.length===1 && value.paths[0]===continuationCandidate.result.anchor.path?continuationCandidate:null;
    return {version:1,projectId:value.projectId,featureId:value.featureId,conversationId:value.conversationId,initialized:value.initialized,paths:[...value.paths],includeTaskBrief:value.includeTaskBrief,...(value.decisionContext?.length?{decisionContext:value.decisionContext.map(item=>({...item}))}:{}),...(value.issueContext?.length?{issueContext:value.issueContext.map(item=>({...item}))}:{}),...(planContext?{planContext}:{}),...(requestRevision?{requestRevision}:{}),...(groupRevision?{groupRevision}:{}),
      ...(checkContext?{checkContext}:{}),...(sourceInvestigation?{sourceInvestigation}:{}),...(investigationContext?{investigationContext}:{}),...(alternativeGenerationDraft?{alternativeGenerationDraft}:{})};
  }
  function validateGroupRevision(value) {
    const keys=["version","conversationId","requestId","groupId","groupRevision","groupDigest"];
    if(!value || typeof value!=="object" || Array.isArray(value) || value.version!==1 || Object.keys(value).some(key=>!keys.includes(key)) || ![value.conversationId,value.requestId,value.groupId].every(item=>validAssistantIdentity(item)) || typeof value.groupDigest!=="string" || !/^[a-f0-9]{64}$/.test(value.groupDigest) || !Number.isSafeInteger(value.groupRevision) || value.groupRevision<0)return null;
    return {version:1,conversationId:value.conversationId,requestId:value.requestId,groupId:value.groupId,groupRevision:value.groupRevision,groupDigest:value.groupDigest};
  }
  function validateCheckContext(value) {
    const keys=["version","conversationId","requestId","groupId","groupRevision","groupDigest","snapshotRevision","tasks"];
    if(!value || typeof value!=="object" || Array.isArray(value) || Object.keys(value).some(key=>!keys.includes(key)) || !validateGroupRevision(Object.fromEntries(Object.entries(value).filter(([key])=>!["snapshotRevision","tasks"].includes(key)))) || !/^[a-f0-9]{64}$/.test(value.snapshotRevision || "") || !Array.isArray(value.tasks) || !value.tasks.length || value.tasks.length>2 || new Set(value.tasks.map(task=>task?.id)).size!==value.tasks.length || value.tasks.some(task=>!task || Object.keys(task).some(key=>!["id","label"].includes(key)) || !["node:test","typescript:check"].includes(task.id) || typeof task.label!=="string" || !task.label.trim() || task.label.length>160))return null;
    return {...validateGroupRevision(Object.fromEntries(Object.entries(value).filter(([key])=>!["snapshotRevision","tasks"].includes(key)))),snapshotRevision:value.snapshotRevision,tasks:value.tasks.map(({id,label})=>({id,label}))};
  }
  function validateRequestRevision(value) {
    if(!value || typeof value!=="object" || Array.isArray(value) || value.version!==1 || Object.keys(value).some(key=>!["version","conversationId","requestId"].includes(key)) || ![value.conversationId,value.requestId].every(item=>validAssistantIdentity(item)))return null;
    return {version:1,conversationId:value.conversationId,requestId:value.requestId};
  }
  function validatePlanDescriptor(value) {
    const keys=["version","conversationId","requestId","artifactId","revision","stepId"];
    if(!value || typeof value!=="object" || value.version!==1 || Object.keys(value).some(key=>!keys.includes(key)) || ![value.conversationId,value.requestId,value.artifactId,value.stepId].every(item=>validAssistantIdentity(item)) || !Number.isSafeInteger(value.revision) || value.revision<0)return null;
    return {version:1,conversationId:value.conversationId,requestId:value.requestId,artifactId:value.artifactId,revision:value.revision,stepId:value.stepId};
  }
  function assistantIdentity() {
    if(!state.trusted || !state.project || !state.features || !state.conversations || state.features.projectId!==state.project.id || state.conversations.projectId!==state.project.id)return null;
    return {projectId:state.project.id,featureId:state.features.activeId || null,conversationId:state.conversations.activeId || null};
  }
  function matchingAssistantIdentity(a,b) { return Boolean(a && b && a.projectId===b.projectId && a.featureId===b.featureId && a.conversationId===b.conversationId); }
  function currentAssistantContext() {
    const identity=assistantIdentity();
    return managesAssistantContext && identity ? validateAssistantContext({version:1,...identity,initialized:state.contextInitialized,paths:state.context,includeTaskBrief:state.featureTaskIncluded && Boolean(activeFeature()),...(state.decisionContext.length?{decisionContext:state.decisionContext}:{}),...(state.issueContext.length?{issueContext:state.issueContext}:{}),...(state.planContext?{planContext:state.planContext}:{}),...(state.requestRevision?{requestRevision:state.requestRevision}:{}),...(state.groupRevision?{groupRevision:state.groupRevision}:{}),...(state.checkContext?{checkContext:state.checkContext}:{}),...(state.investigationContext?{sourceInvestigation:state.investigationContext}:{}),...(state.continuationContext?{investigationContext:state.continuationContext}:{}),...(state.alternativeGenerationDraft?{alternativeGenerationDraft:state.alternativeGenerationDraft}:{})}) : null;
  }
  function markAssistantDraftEdited(cancelPreparation=true) {
    if(cancelPreparation){if(pendingContinuation)clearContinuation();if(pendingSourceInvestigation)clearSourceInvestigation();pendingPlanPreparation=null;pendingRequestRevision=null;pendingGroupRevision=null;pendingCheckSuggestion=null;assistantDraftGeneration++;}
    assistantDraftEdited=true;pendingAssistantRestore=null;coldAssistantContextResolved=true;
  }
  function detachRequestRevision() {state.alternativeGenerationDraft=null;clearContinuation();clearSourceInvestigation();state.checkContext=null;state.checkContextNotice="";pendingCheckSuggestion=null;state.groupRevision=null;state.groupRevisionNotice="";pendingGroupRevision=null;state.requestRevision=null;state.requestRevisionNotice="";pendingRequestRevision=null;assistantDraftGeneration++;}
  function clearAssistantSourceRestore() {
    state.alternativeGenerationDraft=null;state.decisionContext=[];state.issueContext=[];clearContinuation();clearSourceInvestigation();state.checkContext=null;state.checkContextNotice="";pendingCheckSuggestion=null;state.groupRevision=null;state.groupRevisionNotice="";pendingGroupRevision=null;assistantRestoreRequest=null;state.contextRestoreLoading=false;state.contextUnavailable=[];state.planContext=null;state.requestRevision=null;state.requestRevisionNotice="";pendingRequestRevision=null;assistantDraftGeneration++;pendingPlanAction=null;pendingPlanPreparation=null;
  }
  function requestAssistantSources() {
    const identity=assistantIdentity();if(!managesAssistantContext || !identity)return;
    const paths=state.context.filter(validContextPath).slice(0,32),requestId=`restore-context-${crypto.randomUUID()}`;
    assistantRestoreRequest={requestId,...identity,paths};state.contextRestoreLoading=paths.length>0;
    state.contextUnavailable=state.contextUnavailable.filter(item=>paths.includes(item.path));
    vscode.postMessage({type:"assistantRestoreContext",requestId,...identity,paths});
  }
  function hydrateAssistantContext() {
    if(coldAssistantContextResolved || !managesAssistantContext)return;
    // Keep an explicit empty selection while project metadata is still loading.
    state.contextInitialized=true;
    if(assistantDraftEdited){pendingAssistantRestore=null;coldAssistantContextResolved=true;return;}
    if(!state.project || !state.trusted)return;
    if(!pendingAssistantRestore || pendingAssistantRestore.context.projectId!==state.project.id){
      pendingAssistantRestore=null;coldAssistantContextResolved=true;state.context=[];state.featureTaskIncluded=false;state.question="";state.intent="ask";return;
    }
    const identity=assistantIdentity();if(!identity)return;
    if(!matchingAssistantIdentity(identity,pendingAssistantRestore.context)){
      pendingAssistantRestore=null;coldAssistantContextResolved=true;state.context=[];state.featureTaskIncluded=false;state.question="";state.intent="ask";return;
    }
    const restored=pendingAssistantRestore;pendingAssistantRestore=null;coldAssistantContextResolved=true;
    state.context=[...restored.context.paths];state.contextInitialized=restored.context.initialized;state.decisionContext=restored.context.decisionContext || [];state.issueContext=restored.context.issueContext || [];
    state.featureTaskIncluded=restored.context.includeTaskBrief && Boolean(activeFeature());
    state.alternativeGenerationDraft=restored.intent==="build"?restored.context.alternativeGenerationDraft || null:null;
    state.question=restored.question;state.intent=restored.intent;state.planContext=restored.context.planContext || null;state.requestRevision=restored.context.requestRevision || null;state.groupRevision=restored.context.groupRevision || null;state.checkContext=restored.context.checkContext || null;state.investigationContext=restored.context.sourceInvestigation || null;state.investigationRefreshed=false;state.continuationContext=restored.context.investigationContext || null;state.continuationRefreshed=false;
    if(restored.revisionInvalid)state.requestRevisionNotice="The saved request link could not be restored. Your draft is now a new request.";
    if(restored.groupRevisionInvalid)state.groupRevisionNotice="The saved group refinement could not be restored. Your draft is now a new request.";
    if(restored.continuationInvalid)state.continuationNotice="The saved continuation could not be restored. Your draft is now a new request.";
    if(restored.investigationInvalid)state.investigationNotice="The saved investigation could not be restored. Your draft is now a new request.";
    if(restored.checkContextInvalid)state.checkContextNotice="The saved check request could not be restored. Your draft is now a new request.";
    validateRestoredRequestRevision();validateRestoredGroupRevision();validateRestoredCheckContext();
    if(restored.context.initialized)requestAssistantSources();
  }
  function unavailableContextPaths() {
    const available=new Set(sourceFiles().map(file=>file.path)),unavailable=new Set(state.contextUnavailable.map(item=>item.path));
    return state.context.filter(path=>!available.has(path) || unavailable.has(path));
  }
  function contextRestoreBlocker() {
    if(state.contextRestoreLoading)return "Loading your selected saved source…";
    if(unavailableContextPaths().length)return "Some selected source is unavailable. Retry or remove it from Context.";
    return "";
  }

  function saveView() {
    const preserved=pendingAssistantRestore;
    const context=preserved?.context || currentAssistantContext();
    vscode.setState({ mode: state.mode, question: preserved ? preserved.question : state.question, intent: preserved ? preserved.intent : state.intent,
      ...(managesAssistantContext ? {assistantContext:context} : {}),
      knowledge:knowledgeDraft(),knowledgeOpenProjectId,
      decisionDrafts:[...decisionDrafts.values()].slice(-16),
      issueDrafts:[...issueDrafts.values()].slice(-16),
      designWidth: state.designWidth, designTheme: state.designTheme, previewMode: state.previewMode, layouts: state.layouts,
      questionProjectId: preserved ? preserved.context.projectId : state.project?.id, questionConversationId: preserved ? preserved.context.conversationId : state.conversations?.activeId || null, sidebarContextOpen:state.sidebarContextOpen, featureDrafts:[...featureDrafts], runtimeDefinitionDrafts:[...runtimeDefinitionDrafts], manualRunDrafts:[...manualRunDrafts],matrixDrafts:[...matrixDrafts.values()].slice(-16),suiteDrafts:[...suiteDrafts.values()].slice(-16),replayChoices:[...replayChoices.values()].slice(-40),observationComparisons:[...observationComparisons.values()].slice(-16),visualVerificationDrafts:[...visualVerificationDrafts.values()].slice(-16),visualAlternativesDrafts:[...alternativeDrafts.values()].slice(-16),visualAlternativeDisclosures:[...alternativeDisclosures.values()].slice(-80),visualAlternativeComparisons:[...alternativeComparisons.values()].slice(-16),planDrafts:persistablePlanDrafts(),checkSuggestionDrafts:[...checkSuggestionDrafts].slice(-16) });
  }
  function setMode(mode) {
    if (externalAssistant && mode === "Assistant") { action("foundation.askAI"); return; }
    if (assistantSurface && mode !== "Assistant") { if (["Understand", "Refine", "Review"].includes(mode)) action(`foundation.${mode.toLowerCase()}`); return; }
    if (!modes.includes(mode)) return;
    if (mainSurface) scrollPositions.set(state.mode, mainSurface.scrollTop);
    state.mode = mode;
    if(externalAssistant && !assistantSurface && ["Understand","Refine","Review"].includes(mode))vscode.postMessage({type:"workspaceMode",mode});
    saveView();
    render();
    if (mode === "Assistant") composer?.focus();
  }
  function badge(label = "From source", kind = "source") {
    const b = el("span", `badge ${kind}`, label);
    b.prepend(el("i"));
    return b;
  }
  function sectionHeading(title, count) {
    const h = el("div", "section-heading");
    h.append(el("h2", "", title));
    if (count !== undefined) h.append(el("span", "count", count));
    return h;
  }
  function contentDetails(label, key, content, className = "content-details", initiallyOpen = false) {
    const details = el("details", className);
    details.open = disclosureState.has(key) ? disclosureState.get(key) === true : initiallyOpen;
    details.addEventListener("toggle", () => disclosureState.set(key, details.open));
    const summary = el("summary", "", label); summary.dataset.artifactFocus = key;
    details.append(summary, ...content); return details;
  }
  // Expensive workspace evidence and editors are materialized only while open.
  // Native details/summary semantics remain intact; drafts live in their models.
  function lazyDisclosureOwner() { return JSON.stringify([state.project?.id || null, state.features?.activeId || null]); }
  function lazyContentDetails(label, key, createContent, className = "content-details", initiallyOpen = false) {
    const details = el("details", className), summary = el("summary", "", label);
    details.dataset.lazyDisclosure = key; details.dataset.disclosureOwner = lazyDisclosureOwner();
    const savedAlternative=key.startsWith("alternatives/")?alternativeDisclosures.get(JSON.stringify([state.project?.id,key])):null;
    details.open = disclosureState.has(key) ? disclosureState.get(key) === true : savedAlternative ? savedAlternative.open : initiallyOpen;
    summary.dataset.artifactFocus = key; summary.dataset.lazyDisclosure = key; details.append(summary);
    let hydrated = false;
    const hydrate = () => { if (!hydrated) { details.append(...createContent()); hydrated = true; } };
    if (details.open) hydrate();
    details.addEventListener("toggle", () => {
      // Replaced details can deliver a queued toggle. They must not overwrite
      // the live disclosure state or hydrate a former project's content.
      if (!details.isConnected || !state.trusted || details.dataset.disclosureOwner !== lazyDisclosureOwner()) return;
      disclosureState.set(key, details.open);
      if(key.startsWith("alternatives/") && state.project){const owner=JSON.stringify([state.project.id,key]);alternativeDisclosures.delete(owner);alternativeDisclosures.set(owner,{projectId:state.project.id,key,open:details.open});while(alternativeDisclosures.size>80)alternativeDisclosures.delete(alternativeDisclosures.keys().next().value);saveView();}
      if (details.open) hydrate();
    });
    return details;
  }
  function captureLazyDisclosures() {
    if (!state.trusted) return;
    const owner = lazyDisclosureOwner();
    for (const details of root.querySelectorAll("details[data-lazy-disclosure]"))
      if (details.dataset.disclosureOwner === owner) disclosureState.set(details.dataset.lazyDisclosure, details.open);
  }
  function askAboutSource(file) {
    if (externalAssistant) {
      vscode.postMessage({type:"action", id:"foundation.askAI", projectId:state.project?.id, contextPath:file.path, intent:"ask"}); return;
    }
    state.context = [file.path]; state.contextInitialized = true;detachRequestRevision();markAssistantDraftEdited();setMode("Assistant");
  }
  function note(text, kind = "") {
    const n = el("div", `note ${kind}`);
    n.append(
      icon(kind === "error" ? "shield" : "source", 14),
      el("span", "", text),
    );
    return n;
  }
  function fileLink(path, line, title, detail) {
    const b = el("button", "file-link");
    b.type = "button";
    b.title = `${path}:${line || 1}`;
    b.addEventListener("click", () => navigate(path, line));
    const copy = el("span", "file-link-copy");
    copy.append(el("strong", "", title || basename(path)));
    if (detail) copy.append(el("small", "", detail));
    b.append(icon("source", 16), copy, icon("external", 13));
    return b;
  }
  function activeDirty() {
    return Boolean(
      state.activeFile && state.dirtyPaths.includes(state.activeFile.path),
    );
  }
  function sourceFiles() {
    const unique = new Map();
    for (const file of [...(state.assistantContextFiles || []), ...(state.featureFiles || []), ...(state.openFiles || []), state.activeFile].filter(
      Boolean,
    ))
      if (typeof file.path === "string") unique.set(file.path, file);
    return [...unique.values()];
  }
  function selectedFiles() {
    const files = sourceFiles();
    return state.context.flatMap((path) => {
      const file = files.find((item) => item.path === path);
      return file && !state.contextUnavailable.some(item=>item.path===path) ? [file] : [];
    });
  }
  function choosePrimary(file) {
    const stem = basename(file.path).replace(/\.[^.]+$/, "");
    const selectedLine = state.selection?.startLine;
    return (
      file.analysis?.symbols.find(
        (symbol) =>
          selectedLine >= symbol.line && selectedLine <= symbol.endLine,
      ) ||
      file.analysis?.symbols.find((symbol) => symbol.name === stem) ||
      file.analysis?.symbols.find(
        (symbol) =>
          symbol.exported && ["function", "class"].includes(symbol.kind),
      )
    );
  }
  function header() {
    const head = el("header", "workspace-header");
    const project = button("", () => action("foundation.openProject"), "workspace-project");
    project.setAttribute("aria-label", `Open project folder · ${state.project?.name || "Foundation"}`);
    project.title = state.project?.name || "Foundation";
    project.append(el("span", "foundation-mark", "F"), el("strong", "project-name", state.project?.name || "Foundation"));
    const tabs = el("nav", "activity-tabs");
    tabs.setAttribute("aria-label", "Foundation activity");
    for (const [name, glyph] of [["Understand", "graph"], ["Refine", "inspect"], ["Review", "review"], ...externalAssistant ? [] : [["Assistant", "spark"]]]) {
      const selected = name === "Assistant" && externalAssistant ? state.assistantSurface?.visible === true : state.mode === name;
      const b = button(name, () => name === "Assistant" && externalAssistant ? action("foundation.toggleAssistant") : setMode(name), selected ? "activity selected" : "activity", glyph);
      b.setAttribute("aria-pressed", String(selected));
      b.setAttribute("aria-label", name); b.title = name; b.dataset.mode = name;
      tabs.append(b);
    }
    const tools = el("div", "header-tools");
    if (externalAssistant) {
      const assistant = button("Assistant", () => action("foundation.toggleAssistant"), "button small assistant-toggle", "spark");
      assistant.setAttribute("aria-label", "Assistant"); assistant.setAttribute("aria-pressed", String(state.assistantSurface?.visible === true));
      assistant.title = "Show or hide Assistant · ⌥⌘A"; assistant.dataset.mode = "Assistant"; tools.append(assistant);
    }
    const build = button("", () => state.activeFile && navigate(state.activeFile.path, state.focus?.line || 1), "icon-button", "code");
    build.setAttribute("aria-label", "Open editor"); build.title = "Open selected source beside canvas"; build.disabled = !state.activeFile;
    const menu = el("details", "workspace-menu");
    const trigger = el("summary", "icon-button"); trigger.setAttribute("aria-label", "Workspace tools"); trigger.title = "Workspace tools"; trigger.append(icon("folder"));
    const options = el("div", "workspace-menu-items");
    for (const [label, glyph, id] of [["Maximize / restore editor group", "inspect", "foundation.focusWorkspace"], ["Open folder", "folder", "foundation.openProject"], ["Search source", "search", "foundation.openSearch"], ["Open terminal", "terminal", "foundation.openTerminal"], ["Refresh source", "refresh", "foundation.refresh"]]) {
      options.append(button(label, () => { menu.open = false; action(id); }, "workspace-menu-item", glyph));
    }
    options.append(button("Reset inspector", () => { menu.open = false; saveInspectorWidth(320); state.inspectorOpen = false; applyStudioLayout(); }, "workspace-menu-item", "refresh"));
    menu.addEventListener("keydown", event => { if(event.key === "Escape") { menu.open = false; trigger.focus(); } });
    menu.append(trigger, options); tools.append(build, menu); head.append(project, tabs, tools);
    const focus = el("div", "workspace-focus"); focus.setAttribute("aria-label", "Workspace selection");
    const selected = state.focus;
    if (state.activeFile) {
      const link = button("", () => navigate(state.activeFile.path, selected?.line || 1), "selection-source");
      link.title = state.activeFile.path;
      link.append(icon(["preview","runtime"].includes(selected?.origin) ? "inspect" : "source"), el("strong", "", selected?.label || choosePrimary(state.activeFile)?.name || basename(state.activeFile.path)), el("span", "selection-path", state.activeFile.path));
      focus.append(link, el("code", "selection-revision", state.activeFile.revision.slice(0,7)));
      if (activeDirty()) focus.append(el("span", "selection-state", "Unsaved draft"));
      else if (selected?.stale) focus.append(el("span", "selection-state warning", selected?.origin === "runtime" ? "Mapping stale" : "Preview stale"));
      else focus.append(el("span", "selection-state", selected?.origin === "runtime" ? "From running app" : selected?.origin === "preview" ? "From canvas" : "Saved source"));
    } else focus.append(el("span", "quiet", "Select source or an element in the canvas"));
    return [head, focus];
  }
  function emptyState() {
    const wrap = el("div", "empty-state");
    const glyph = el("div", "empty-glyph");
    glyph.append(icon(state.trusted ? "source" : "shield", 30));
    wrap.append(glyph);
    if (!state.connected) {
      wrap.append(
        el("h1", "", "Connecting to the editor"),
        el(
          "p",
          "",
          "Loading your project and saved source.",
        ),
      );
      return wrap;
    }
    if (!state.trusted) {
      wrap.append(
        el("h1", "", "Trust this folder"),
        el(
          "p",
          "",
          "Trust this folder to enable source analysis and previews. You can keep editing without trust.",
        ),
      );
      wrap.append(
        button(
          "Manage workspace trust",
          () => action("foundation.manageTrust"),
          "button primary",
          "shield",
        ),
      );
      return wrap;
    }
    if (!state.project) {
      wrap.append(
        el("h1", "", "Open a project"),
        el(
          "p",
          "",
          "Choose a folder to explore its source and preview the app.",
        ),
      );
      wrap.append(
        button(
          "Open a project",
          () => action("foundation.openProject"),
          "button primary",
          "folder",
        ),
      );
      return wrap;
    }
    wrap.append(
      el("h1", "", "Select a source file"),
      el(
        "p",
        "",
        "Open a file to see its dependencies, declarations, and requests.",
      ),
    );
    wrap.append(
      button(
        "Find a file",
        () => action("foundation.build"),
        "button primary",
        "source",
      ),
    );
    const files = state.project.files?.slice(0, 6) || [];
    if (files.length) {
      const list = el("div", "empty-files");
      list.append(el("span", "quiet", "Project files"));
      for (const file of files)
        list.append(
          fileLink(file.path, 1, basename(file.path), pathParent(file.path)),
        );
      wrap.append(list);
    }
    return wrap;
  }
  function sourceHeading(file, title) {
    const h = el("div", "source-heading");
    const copy = el("div", "source-heading-copy");
    copy.append(el("h1", "", title));
    const meta = el("div", "source-heading-meta"); meta.append(badge());
    if (state.selection?.startLine) meta.append(el("span", "revision", state.selection.startLine === state.selection.endLine
      ? `Line ${state.selection.startLine}` : `Lines ${state.selection.startLine}–${state.selection.endLine}`));
    copy.append(meta);
    h.append(copy, button("Ask about this source", () => askAboutSource(file), "button", "spark"));
    return h;
  }
  function activeFeature() {
    return state.features?.features?.find(feature => feature.id === state.features.activeId && !feature.archived) || null;
  }
  function featureKey(id) { return `${state.project?.id || "project"}/${id}`; }
  function featureValues(feature) {
    return { title:String(feature?.title || ""), brief:String(feature?.brief || ""), paths:[...(feature?.paths || [])], entryPath:feature?.entryPath || null };
  }
  function featureDigest(feature) {
    const values=featureValues(feature); values.title=values.title.trim();
    return JSON.stringify(values);
  }
  function featureDraft(id) {
    const key=featureKey(id), saved=state.features?.features?.find(feature=>feature.id===id);
    if(!featureDrafts.has(key)) featureDrafts.set(key,{...featureValues(saved),base:featureDigest(saved),baseRevision:state.features?.revision || 0});
    return featureDrafts.get(key);
  }
  function featureDraftChanged(id) {
    const draft=featureDrafts.get(featureKey(id));
    return Boolean(draft && featureDigest(draft)!==draft.base);
  }
  function featureDraftConflict(id) {
    if(id==="new")return false;
    const saved=state.features?.features?.find(feature=>feature.id===id),draft=featureDrafts.get(featureKey(id));
    return Boolean(saved && draft && draft.base!==featureDigest(saved) && featureDigest(draft)!==featureDigest(saved));
  }
  function featureStoreBlocked() { return state.running || runtimeMatrixBusy() || ["saving","error","unavailable"].includes(state.features?.storage?.status); }
  function featureTaskBlocker() {
    const feature=activeFeature();
    if(!feature || !state.featureTaskIncluded)return "";
    if(featureStoreBlocked())return "Resolve feature storage before sharing its task context.";
    if(featureDraftChanged(feature.id))return "Save or discard the feature draft before sending.";
    return "";
  }
  function featureAction(action, extra={}) {
    if(!state.trusted || !state.project || !state.features)return;
    if(action!=="retry" && featureStoreBlocked())return;
    if(action==="prepare" && activeFeature() && featureDraftChanged(activeFeature().id))return;
    vscode.postMessage({type:"feature",action,projectId:state.project.id,expectedRevision:state.features.revision,...extra});
  }
  function refreshFeatureDraftControls() {
    for(const form of root.querySelectorAll(".feature-edit-form")) {
      const id=form.dataset.featureId,draft=featureDraft(id),conflict=featureDraftConflict(id);
      const valid=Boolean(draft.title.trim()) && draft.title.trim().length<=80 && draft.brief.length<=2000 && draft.paths.length<=32;
      const save=form.querySelector(".feature-save");
      if(save)save.disabled=featureStoreBlocked() || conflict || !valid || id!=="new"&&!featureDraftChanged(id);
      const status=form.querySelector(".feature-draft-status");
      if(status)status.textContent=conflict?"Saved feature changed. Your draft is preserved; reload it before editing again.":featureDraftChanged(id)?"Unsaved feature draft":"Saved on this device";
    }
    for(const prepare of root.querySelectorAll(".feature-prepare"))prepare.disabled=featureStoreBlocked() || Boolean(activeFeature() && featureDraftChanged(activeFeature().id)) || !activeFeature()?.paths.length;
    updateAskButton();
    const guidance=root.querySelector(".composer-guidance");if(guidance)guidance.textContent=requestBlocker();
  }
  function changeFeatureDraft(id, field, value, rerender=false) {
    featureDraft(id)[field]=value;saveView();
    if(rerender)render();else refreshFeatureDraftControls();
  }
  function addFeaturePath(id,path) {
    const draft=featureDraft(id);
    if(!state.project?.files.some(file=>file.path===path) || draft.paths.includes(path) || draft.paths.length>=32)return;
    draft.paths.push(path);disclosureState.set(`feature/${id}:edit`,true);saveView();render();
  }
  function syncFeatureDrafts() {
    if(!state.features)return;
    for(const feature of state.features.features || []) {
      const draft=featureDrafts.get(featureKey(feature.id));if(!draft)continue;
      if(featureDigest(draft)===draft.base) {
        Object.assign(draft,featureValues(feature),{base:featureDigest(feature),baseRevision:state.features.revision});
      }else if(featureDigest(draft)===featureDigest(feature) && state.features.storage?.status==="saved") {
        draft.base=featureDigest(feature);draft.baseRevision=state.features.revision;
      }else if(draft.base===featureDigest(feature))draft.baseRevision=state.features.revision;
    }
    if(pendingFeatureCreate && state.features.storage?.status==="saved") {
      const created=activeFeature();
      if(created && state.features.revision>pendingFeatureCreate.revision && featureDigest(created)===pendingFeatureCreate.digest) {
        featureDrafts.delete(featureKey("new"));state.featureCreateOpen=false;pendingFeatureCreate=null;
      }
    }
  }
  function featureEditor(id, compact=false) {
    const draft=featureDraft(id),form=el("div","feature-edit-form");form.dataset.featureId=id;
    const titleLabel=el("label","feature-field","Title"),title=el("input");title.type="text";title.disabled=state.running;title.maxLength=80;title.value=draft.title;title.setAttribute("aria-label",id==="new"?"New feature title":"Feature title");title.dataset.designFocus=`feature/${id}/title`;
    title.addEventListener("input",()=>changeFeatureDraft(id,"title",title.value));titleLabel.append(title);
    const briefLabel=el("label","feature-field","Brief"),brief=el("textarea");brief.disabled=state.running;brief.rows=compact?3:4;brief.maxLength=2000;brief.value=draft.brief;brief.placeholder="What should this feature do?";brief.setAttribute("aria-label",id==="new"?"New feature brief":"Feature brief");brief.dataset.designFocus=`feature/${id}/brief`;
    brief.addEventListener("input",()=>changeFeatureDraft(id,"brief",brief.value));briefLabel.append(brief);form.append(titleLabel,briefLabel);
    if(!compact) {
      const files=el("div","feature-edit-files");files.append(sectionHeading("Feature files",`${draft.paths.length} / 32`));
      for(const path of draft.paths) {
        const row=el("div","feature-file-row");row.append(fileLink(path,1,basename(path),path));
        const remove=button("",()=>{draft.paths=draft.paths.filter(item=>item!==path);if(draft.entryPath===path)draft.entryPath=null;saveView();render();},"icon-button","close");remove.disabled=state.running;remove.setAttribute("aria-label",`Remove ${path} from feature`);remove.dataset.designFocus=`feature/${id}/remove/${path}`;row.append(remove);files.append(row);
      }
      const addRow=el("div","feature-add-row"),fileSelect=el("select");fileSelect.setAttribute("aria-label","File to add to feature");fileSelect.dataset.designFocus=`feature/${id}/add-file`;
      const none=el("option","","Choose a project file…");none.value="";fileSelect.append(none);
      for(const file of state.project?.files || [])if(!draft.paths.includes(file.path)){const option=el("option","",file.path);option.value=file.path;fileSelect.append(option);}
      fileSelect.value=draft.addPath || "";fileSelect.disabled=state.running || draft.paths.length>=32;
      const add=button("Add file",()=>addFeaturePath(id,fileSelect.value),"button small");add.disabled=!fileSelect.value || fileSelect.disabled;add.dataset.designFocus=`feature/${id}/add`;
      fileSelect.addEventListener("change",()=>{draft.addPath=fileSelect.value;add.disabled=!fileSelect.value || fileSelect.disabled;saveView();});addRow.append(fileSelect,add);files.append(addRow);
      const entryLabel=el("label","feature-field","Primary file"),entry=el("select");entry.setAttribute("aria-label","Feature primary file");entry.dataset.designFocus=`feature/${id}/primary`;
      const empty=el("option","","No primary file");empty.value="";entry.append(empty);
      for(const path of draft.paths){const option=el("option","",path);option.value=path;option.selected=draft.entryPath===path;entry.append(option);}
      entry.disabled=state.running;entry.value=draft.entryPath || "";entry.addEventListener("change",()=>changeFeatureDraft(id,"entryPath",entry.value || null));entryLabel.append(entry);
      files.append(entryLabel,el("p","feature-caption","The primary file anchors related-source suggestions. It does not bind a runtime screen."));form.append(files);
    }
    const status=el("p","feature-draft-status");status.setAttribute("role","status");
    const actions=el("div","feature-form-actions");
    const save=button(id==="new"?"Create feature":"Save feature",()=>{
      if(featureDraftConflict(id) || !draft.title.trim() || draft.title.trim().length>80 || draft.brief.length>2000)return;
      const input=featureValues(draft);input.title=input.title.trim();
      if(id==="new" && input.entryPath===null)delete input.entryPath;
      if(id==="new")pendingFeatureCreate={revision:state.features.revision,digest:featureDigest(input)};
      featureAction(id==="new"?"create":"update",{...(id!=="new"?{id}:{}),input});
    },"button primary feature-save");save.dataset.designFocus=`feature/${id}/save`;
    save.disabled=featureStoreBlocked() || featureDraftConflict(id) || !draft.title.trim() || id!=="new"&&!featureDraftChanged(id);
    const discard=button(id==="new"?"Cancel":featureDraftConflict(id)?"Reload saved feature":"Discard draft",()=>{featureDrafts.delete(featureKey(id));if(id==="new"){state.featureCreateOpen=false;pendingFeatureCreate=null;}saveView();render();},"button");discard.dataset.designFocus=`feature/${id}/discard`;
    status.textContent=featureDraftConflict(id)?"Saved feature changed. Your draft is preserved; reload it before editing again.":featureDraftChanged(id)?"Unsaved feature draft":"Saved on this device";
    actions.append(save,discard);form.append(status,actions);return form;
  }
  function featureStorageNotice() {
    const status=state.features?.storage?.status;
    if(!["saving","error","unavailable"].includes(status))return null;
    const box=el("div","feature-storage");box.setAttribute("role","status");
    box.append(note(state.features.storage.message || (status==="saving"?"Saving feature…":"Feature storage is unavailable. Your local draft is preserved."),status==="saving"?"":"warning"));
    if(status!=="saving")box.append(button("Retry feature storage",()=>featureAction("retry"),"button small","refresh"));return box;
  }
  function featurePrepareButton() {
    const feature=activeFeature();
    const prepare=button("Use in Assistant",()=>featureAction("prepare",{id:feature.id}),"button feature-prepare","spark");prepare.disabled=featureStoreBlocked() || Boolean(feature && featureDraftChanged(feature.id)) || !feature?.paths.length;prepare.dataset.designFocus="feature/prepare";return prepare;
  }
  function featureRelationshipView() {
    const value=state.featureRelationships,feature=activeFeature();
    return value && feature && value.projectId===state.project?.id && value.featureId===feature.id && value.featureRevision===state.features?.revision ? value : null;
  }
  function relationshipCandidates() {
    const view=featureRelationshipView(),snapshot=view?.snapshot;
    return view && snapshot?.projectId===view.projectId && snapshot.anchor?.path===view.anchorPath ? (snapshot.candidates || []).filter(item=>item.provenance==="filename" && state.project.files.some(file=>file.path===item.path)) : [];
  }
  function relationshipAction(action,extra={}) {
    const view=featureRelationshipView();if(!view || !state.trusted)return;
    vscode.postMessage({type:"featureRelationships",action,projectId:view.projectId,featureId:view.featureId,featureRevision:view.featureRevision,...extra});
  }
  function relationshipEvidenceReady(view,item) {
    const paths=[item.from?.path,item.to?.path,item.source?.path].filter(Boolean),dirty=new Set([...(view.dirtyPaths || []),...state.dirtyPaths]);
    return view.status==="ready" && Boolean(view.snapshotId) && !paths.some(path=>dirty.has(path));
  }
  function relationshipExploreReady(view,path) {
    return view.status==="ready" && Boolean(view.snapshotId) && state.project.files.some(file=>file.path===path);
  }
  function relationshipNavigate(view,item,target) {
    if(relationshipEvidenceReady(view,item))relationshipAction("navigate",{snapshotId:view.snapshotId,evidenceId:item.id,target});
  }
  function relationshipRow(view,item,request=false) {
    const ref=request?item.source:item.from,definition=request?null:item.to;
    const verbs={import:"Imports","re-export":"Re-exports",stylesheet:"Uses stylesheet",render:"Renders",call:"Calls","type-reference":"Uses type","test-reference":"Test reference"};
    const label=request?`${item.method || "Method unknown"} ${item.urlKind==="literal" && item.url ? item.url : "Dynamic URL"}`:`${verbs[item.kind] || "References"} ${definition?.label || basename(definition?.path)}`;
    const ready=relationshipEvidenceReady(view,item),row=el("div","relationship-evidence-row");row.dataset.evidenceId=item.id;
    const open=button("",()=>relationshipNavigate(view,item,"source"),"relationship-evidence-link");open.disabled=!ready;open.setAttribute("aria-label",`Open ${label} at ${ref.path}:${ref.line}`);open.dataset.designFocus=`relationship/${item.id}/source`;
    const copy=el("span","relationship-evidence-copy");copy.append(el("strong","",label),el("small","",`${ref.path}:${ref.line}${ref.label?` · ${ref.label}`:""}`));
    if(item.detail)copy.append(el("small","relationship-detail",item.detail));
    open.append(icon(request?"arrow":"source",16),copy,icon("external",12));row.append(open);
    const actions=el("div","relationship-evidence-actions");
    if(definition && (definition.path!==ref.path || definition.line!==ref.line)) {
      const control=button("",()=>relationshipNavigate(view,item,"definition"),"icon-button","code");control.disabled=!ready;control.title=`Open definition in ${definition.path}:${definition.line}`;control.setAttribute("aria-label",control.title);control.dataset.designFocus=`relationship/${item.id}/definition`;actions.append(control);
    }
    const related=definition && (ref.path===view.anchorPath ? definition.path : ref.path);
    if(related && related!==view.anchorPath && state.project.files.some(file=>file.path===related)) {
      const explore=button("Explore",()=>{if(relationshipExploreReady(view,related))relationshipAction("focus",{path:related});},"button small","arrow");explore.disabled=!relationshipExploreReady(view,related);explore.setAttribute("aria-label",`Explore ${related}`);explore.dataset.designFocus=`relationship/${item.id}/explore`;actions.append(explore);
    }
    if(actions.childElementCount)row.append(actions);
    return row;
  }
  function relationshipGroup(view,title,items,key,request=false) {
    const group=el("section","relationship-group");group.setAttribute("aria-label",title);group.append(sectionHeading(title,items.length));
    if(key==="tests")group.append(el("p","feature-caption","Source references only. Test coverage and execution are unverified."));
    if(request)group.append(el("p","feature-caption","Request expressions in saved source. Runtime results are separate."));
    for(const item of items.slice(0,6))group.append(relationshipRow(view,item,request));
    if(items.length>6)group.append(contentDetails(`Show ${items.length-6} more`, `relationships/${view.featureId}/${view.anchorPath}/${key}:more`,items.slice(6).map(item=>relationshipRow(view,item,request)),"content-details relationship-more"));
    return group;
  }
  function featureRelationships() {
    const view=featureRelationshipView();if(!view)return null;
    const feature=activeFeature(),snapshot=view.snapshot?.projectId===view.projectId?view.snapshot:null,section=el("section","feature-relationships");section.setAttribute("aria-label","Feature relationships");section.setAttribute("aria-busy",String(view.status==="loading"));
    const heading=sectionHeading("Relationships");heading.append(badge("From source"));section.append(heading);
    const toolbar=el("div","relationship-toolbar"),label=el("label","relationship-anchor-label","Source"),select=el("select");select.setAttribute("aria-label","Relationship source");select.dataset.designFocus="relationship/anchor";
    const paths=[...new Set([...feature.paths,...(view.anchorPath?[view.anchorPath]:[])])];
    if(!paths.length){const option=el("option","","No feature files");option.value="";select.append(option);}
    for(const path of paths){const option=el("option","",`${path}${path===feature.entryPath?" · Primary":""}`);option.value=path;select.append(option);}
    select.value=view.anchorPath || "";select.disabled=view.status==="loading" || !paths.length;select.addEventListener("change",()=>relationshipAction("focus",{path:select.value}));label.append(select);toolbar.append(label);
    const controls=el("div","relationship-controls");
    if((view.trail || []).length>1){const back=button("Back",()=>relationshipAction("back"),"button small");back.disabled=view.status==="loading";back.setAttribute("aria-label","Back in relationships");back.dataset.designFocus="relationship/back";controls.append(back);}
    const primary=feature.entryPath || feature.paths[0];
    if(view.anchorPath && (view.anchorPath!==primary || (view.trail || []).length>1)){const reset=button("Reset",()=>relationshipAction("reset"),"button small");reset.disabled=view.status==="loading";reset.setAttribute("aria-label","Reset relationships");reset.dataset.designFocus="relationship/reset";controls.append(reset);}
    const refresh=button("Refresh",()=>relationshipAction("refresh"),"button small","refresh");refresh.disabled=view.status==="loading" || !view.anchorPath;refresh.setAttribute("aria-label","Refresh relationships");refresh.dataset.designFocus="relationship/refresh";controls.append(refresh);
    const investigate=button("Ask about relationships",()=>relationshipAction("investigate",{snapshotId:view.snapshotId}),"button small","spark");investigate.disabled=view.status!=="ready" || !view.snapshotId || state.running || featureStoreBlocked() || Boolean(feature && featureDraftChanged(feature.id));investigate.dataset.designFocus="relationship/investigate";controls.append(investigate);toolbar.append(controls);section.append(toolbar);
    const messages={idle:"Choose a feature file to inspect its relationships.",loading:"Reading saved source…",stale:"Saved source changed. Refreshing relationships…",error:"Relationships could not be read. Refresh to try again."};
    if(view.status!=="ready" || view.message){const status=el("p",`relationship-status${view.status==="error"?" error":""}`,view.message || messages[view.status] || "");status.setAttribute("role","status");section.append(status);}
    const dirty=[...new Set([...(view.dirtyPaths || []),...state.dirtyPaths.filter(path=>snapshot?.manifest?.some(file=>file.path===path))])];
    if(dirty.length)section.append(el("p","relationship-status","Unsaved changes are excluded. Save the affected files to use their evidence links."));
    if(snapshot && snapshot.anchor?.path===view.anchorPath) {
      const edges=Array.isArray(snapshot.edges)?snapshot.edges:[],requests=Array.isArray(snapshot.requests)?snapshot.requests:[];
      const tests=edges.filter(item=>item.kind==="test-reference"),connectionKey=item=>JSON.stringify([item.from.path,item.from.line,item.from.column,item.to.path,item.to.line,item.to.column]);
      const tested=new Set(tests.map(connectionKey)),ordinary=edges.filter(item=>item.kind!=="test-reference" && !tested.has(connectionKey(item)));
      const outgoing=ordinary.filter(item=>item.from.path===view.anchorPath),incoming=ordinary.filter(item=>item.from.path!==view.anchorPath);
      const groups=[["Renders",outgoing.filter(item=>item.kind==="render"),"renders"],["Calls",outgoing.filter(item=>item.kind==="call"),"calls"],["Styles",outgoing.filter(item=>item.kind==="stylesheet"),"styles"],["Types",outgoing.filter(item=>item.kind==="type-reference"),"types"],["Imports",outgoing.filter(item=>["import","re-export"].includes(item.kind)),"imports"],["Used by",incoming,"consumers"],["Test references",tests,"tests"]];
      const content=el("div","relationship-groups"),behavior=el("div","relationship-group-column"),support=el("div","relationship-group-column");
      for(const [title,items,key] of groups)if(items.length)(["renders","calls"].includes(key)?behavior:support).append(relationshipGroup(view,title,items,key));
      if(requests.length)behavior.append(relationshipGroup(view,"Requests in source",requests,"requests",true));
      for(const column of [behavior,support])if(column.childElementCount)content.append(column);
      if(content.childElementCount<2)content.classList.add("single-column");
      if(!edges.length&&!requests.length)content.append(el("p","relationship-empty",snapshot.boundaries?.length?"No supported relationships are available for this file.":"No direct relationships or request expressions found in this saved file."));
      section.append(content);
      if(snapshot.boundaries?.length){const limits=el("ul","relationship-boundaries");for(const boundary of snapshot.boundaries){const item=el("li"),location=boundary.path?`${boundary.path}${boundary.line?`:${boundary.line}`:""} · `:"";item.append(el("span","",`${location}${boundary.detail}`));limits.append(item);}section.append(contentDetails(`Analysis limits · ${snapshot.boundaries.length}`,`relationships/${view.featureId}/${view.anchorPath}:limits`,[limits],"content-details relationship-limits",!edges.length&&!requests.length));}
      const candidates=relationshipCandidates();
      if(candidates.length) {
        const list=el("div","relationship-candidates");list.append(el("p","feature-caption","Filename matches only. Source references and test coverage are unverified."));
        for(const item of candidates){const row=el("div","relationship-candidate"),copy=el("span","relationship-evidence-copy");copy.append(el("strong","",basename(item.path)),el("small","",item.path));const explore=button("Explore",()=>relationshipAction("focus",{path:item.path}),"button small","arrow");explore.setAttribute("aria-label",`Explore possible test ${item.path}`);explore.dataset.designFocus=`relationship/candidate/${item.path}`;explore.disabled=!relationshipExploreReady(view,item.path);row.append(copy,explore);list.append(row);}
        section.append(contentDetails(`Possible tests · ${candidates.length}`,`relationships/${view.featureId}/${view.anchorPath}:candidates`,[list],"content-details relationship-possible-tests"));
      }
      const details=el("div","relationship-provenance");details.append(el("p","",`Saved revision ${snapshot.anchor.revision.slice(0,12)}`),el("p","",`${snapshot.counts?.analyzed ?? 0} files analyzed · ${snapshot.counts?.indexed ?? 0} indexed`),el("p","",`Analyzed ${formatHistoryTime(snapshot.analyzedAt)}`));
      if(snapshot.truncated)details.append(el("p","","Analysis reached its limit; these results are incomplete."));
      details.append(el("p","","Static source references do not establish runtime behavior."));section.append(contentDetails("Analysis details",`relationships/${view.featureId}/${view.anchorPath}:details`,[details],"content-details relationship-analysis"));
      if(snapshot.truncated)section.append(el("p","relationship-status","Results are incomplete. See Analysis limits for the analysis boundary."));
    }else if(view.status==="ready")section.append(el("p","relationship-empty","No saved analysis is available. Refresh to read this file."));
    return section;
  }

  function featureWorkspace() {
    const section=el("section","feature-workspace");section.setAttribute("aria-label","Feature workspace");
    const top=el("div","feature-toolbar"),label=el("label","feature-selector-label","Feature"),select=el("select");select.setAttribute("aria-label","Active feature");select.dataset.designFocus="feature/active";
    const empty=el("option","","No feature selected");empty.value="";select.append(empty);
    for(const feature of state.features.features || [])if(!feature.archived){const option=el("option","",feature.title);option.value=feature.id;select.append(option);}
    select.value=state.features.activeId || "";select.disabled=featureStoreBlocked();select.addEventListener("change",()=>featureAction("select",{id:select.value || null}));label.append(select);
    const create=button("New feature",()=>{state.featureCreateOpen=true;featureDraft("new");saveView();render();root.querySelector('[data-design-focus="feature/new/title"]')?.focus();},"button small","plus");create.disabled=featureStoreBlocked();create.dataset.designFocus="feature/new";top.append(label,create);section.append(top);
    const storage=featureStorageNotice();if(storage)section.append(storage);
    if(state.featureCreateOpen)section.append(featureEditor("new"));
    const feature=activeFeature();
    if(feature) {
      const overview=el("div","feature-overview");overview.append(el("p","feature-brief",feature.brief || "Add a brief to describe the intended behavior."));
      const actions=el("div","feature-overview-actions");actions.append(el("span","feature-caption",`${feature.paths.length} ${feature.paths.length===1?"file":"files"} · saved on this device`),featurePrepareButton());overview.append(actions);section.append(overview);
      const files=el("div","feature-saved-files");for(const path of feature.paths)files.append(fileLink(path,1,basename(path),path===feature.entryPath?`Primary file · ${path}`:path));
      if(!feature.paths.length)files.append(el("p","empty-copy","Choose saved project files for this feature. They are not shared with AI until selected in Context."));
      section.append(contentDetails(`Feature files · ${feature.paths.length}`,`feature/${feature.id}:files`,[files],"content-details feature-file-details"));
      if(state.featureUnavailable.length){const unavailable=el("ul","feature-unavailable");for(const item of state.featureUnavailable)unavailable.append(el("li","",`${item.path}: ${item.reason}`));section.append(contentDetails("Unavailable feature files",`feature/${feature.id}:unavailable`,[unavailable]));}
      const decisions=decisionsForScope("feature",feature.id);if(decisions)section.append(decisions);
      const issues=issuesForScope("feature",feature.id);if(issues)section.append(issues);
      const relationships=featureRelationships();if(relationships)section.append(relationships);
      const runtimeWorkspace=featureRuntimeWorkspace();if(runtimeWorkspace)section.append(runtimeWorkspace);
      section.append(lazyContentDetails("Edit feature",`feature/${feature.id}:edit`,()=>[featureEditor(feature.id)],"content-details feature-edit-details"));
      const candidates=(state.featureCandidates || []).filter(item=>state.project?.files.some(file=>file.path===item.path) && !(item.provenance==="filename" && relationshipCandidates().some(candidate=>candidate.path===item.path)));
      if(candidates.length){
        const related=el("div","feature-candidates");
        for(const [provenance,title] of [["source","Related source"],["filename","Possible tests"]]) {
          const items=candidates.filter(item=>item.provenance===provenance);if(!items.length)continue;
          related.append(el("h3","",title));if(provenance==="filename")related.append(el("p","feature-caption","Filename matches only. Test coverage has not been verified."));
          for(const item of items){const row=el("div","feature-candidate-row");row.append(fileLink(item.path,item.line || 1,basename(item.path),item.reason==="import"?"Import relationship · From source":item.reason==="consumer"?"Direct consumer · From source":"Filename match"));const add=button("Add",()=>addFeaturePath(feature.id,item.path),"button small");add.setAttribute("aria-label",`Add ${item.path} to feature`);add.dataset.designFocus=`feature/candidate/${item.path}`;add.disabled=state.running || featureDraft(feature.id).paths.includes(item.path) || featureDraft(feature.id).paths.length>=32;row.append(add);related.append(row);}
        }
        section.append(contentDetails("Suggested files",`feature/${feature.id}:suggestions`,[related],"content-details feature-suggestions"));
      }
    }else if(!state.featureCreateOpen)section.append(el("p","feature-empty","Group a feature’s brief and source files, then choose when to use them with Assistant."));
    const manage=el("div","feature-management");
    if(feature){const archive=button("Archive this feature",()=>featureAction("archive",{id:feature.id,archived:true}),"button small");archive.disabled=featureStoreBlocked();manage.append(archive);}
    const archived=(state.features.features || []).filter(item=>item.archived);
    for(const item of archived){const row=el("div","feature-archive-row"),restore=button("Restore",()=>featureAction("archive",{id:item.id,archived:false}),"button small");restore.disabled=featureStoreBlocked();row.append(el("span","",item.title),restore);manage.append(row);}
    if(!feature&&!archived.length)manage.append(el("p","feature-caption","No archived features."));
    section.append(contentDetails(`Manage features${archived.length?` · ${archived.length} archived`:""}`,"feature/manage",[manage]));return section;
  }
  function featureScreens(includeArchived=false) {
    const id=activeFeature()?.id;return (state.runtimeWorkspace?.screens || []).filter(screen=>screen.featureId===id && (includeArchived || !screen.archived));
  }
  function selectedScreen() { return featureScreens().find(screen=>screen.id===state.runtimeWorkspace?.activeScreenId) || null; }
  function selectedScenario() { return (state.runtimeWorkspace?.scenarios || []).find(scenario=>scenario.id===state.runtimeWorkspace?.activeScenarioId && scenario.screenId===selectedScreen()?.id && !scenario.archived) || null; }
  function recordingRun() { const run=state.runtimeWorkspace?.activeRun;return run?.status==="recording"?run:null; }
  function runtimeWorkspaceBlocked(metadata=false) {
    return !state.runtimeWorkspace || state.running || runtimeReplayBusy() || runtimeMatrixBusy() || Boolean(state.runtimeWorkspace.busy) || ["saving","error","unavailable"].includes(state.runtimeWorkspace.storage?.status) || metadata && Boolean(recordingRun());
  }
  function runtimeWorkspaceAction(action,extra={}) {
    if(!state.trusted || !state.project || !state.runtimeWorkspace)return;
    if(action!=="retry" && runtimeWorkspaceBlocked(!["finishRun","cancelRun","captureAndFinishRun"].includes(action)))return;
    if(action==="captureAndFinishRun" && (captureRunBlocker() || recordingRun()?.id!==extra.id))return;
    vscode.postMessage({type:"runtimeWorkspace",action,projectId:state.project.id,expectedRevision:state.runtimeWorkspace.revision,...extra});
  }
  function definitionValues(kind,value={}) {
    return kind==="screen"?{title:value.title || "",targetId:value.targetId || "",route:value.route || "/"}:{title:value.title || "",steps:Array.isArray(value.steps)?value.steps.join("\n"):value.steps || "",expectedOutcome:value.expectedOutcome || "",screenId:value.screenId || selectedScreen()?.id || ""};
  }
  function definitionKey(kind,id) { return `${state.project?.id}/${activeFeature()?.id}/${kind}/${id}`; }
  function savedDefinition(kind,id) { return state.runtimeWorkspace?.[kind==="screen"?"screens":"scenarios"]?.find(item=>item.id===id); }
  function definitionDraft(kind,id) {
    const key=definitionKey(kind,id);
    if(!runtimeDefinitionDrafts.has(key)){const values=definitionValues(kind,savedDefinition(kind,id));runtimeDefinitionDrafts.set(key,{...values,base:JSON.stringify(values)});}
    return runtimeDefinitionDrafts.get(key);
  }
  function definitionDirty(kind,id) { const draft=runtimeDefinitionDrafts.get(definitionKey(kind,id));return Boolean(draft && JSON.stringify(definitionValues(kind,draft))!==draft.base); }
  function definitionConflict(kind,id) {
    const draft=runtimeDefinitionDrafts.get(definitionKey(kind,id)),saved=savedDefinition(kind,id);
    return Boolean(draft && saved && draft.base!==JSON.stringify(definitionValues(kind,saved)) && JSON.stringify(definitionValues(kind,draft))!==JSON.stringify(definitionValues(kind,saved)));
  }
  function syncRuntimeDefinitionDrafts() {
    for(const kind of ["screen","scenario"])for(const item of state.runtimeWorkspace?.[kind==="screen"?"screens":"scenarios"] || []){
      const key=definitionKey(kind,item.id),draft=runtimeDefinitionDrafts.get(key);if(!draft)continue;
      const values=definitionValues(kind,item),digest=JSON.stringify(values);
      if(JSON.stringify(definitionValues(kind,draft))===draft.base)Object.assign(draft,values,{base:digest});
      else if(JSON.stringify(definitionValues(kind,draft))===digest && state.runtimeWorkspace.storage?.status==="saved")draft.base=digest;
    }
    if(pendingRuntimeDefinition && state.runtimeWorkspace?.storage?.status==="saved" && state.runtimeWorkspace.revision>pendingRuntimeDefinition.revision){
      const {kind,digest}=pendingRuntimeDefinition;
      if(state.runtimeWorkspace[kind==="screen"?"screens":"scenarios"].some(item=>JSON.stringify(definitionValues(kind,item))===digest)){
        runtimeDefinitionDrafts.delete(definitionKey(kind,"new"));state.runtimeEditor=null;pendingRuntimeDefinition=null;
      }
    }
  }
  function definitionValidation(kind,draft) {
    if(!draft.title.trim() || draft.title.trim().length>80 || /[\r\n]/.test(draft.title))return "Add a title up to 80 characters.";
    if(kind==="screen"){
      if(!draft.targetId)return "Choose a development target.";
      if(draft.route.length>512 || !/^\/[A-Za-z0-9/._~!$&'()*+,;=@-]*$/.test(draft.route) || draft.route.includes("//") || draft.route.split("/").some(part=>part==="." || part==="..") || /^\/__foundation(?:\/|$)/.test(draft.route))return "Use a plain route such as /profile. Queries, fragments, encoded paths, and reserved routes are unavailable.";
    }else{
      const steps=draft.steps.split("\n").map(step=>step.trim()).filter(Boolean);
      if(!draft.screenId)return "Choose a screen before adding a scenario.";
      if(!steps.length || steps.length>12 || steps.some(step=>step.length>500))return "Add one to twelve steps, up to 500 characters each.";
      if(!draft.expectedOutcome.trim() || draft.expectedOutcome.length>2000)return "Describe the expected result, up to 2,000 characters.";
    }
    return "";
  }
  function runtimeDefinitionDraftPending() {
    const prefix=`${state.project?.id}/${activeFeature()?.id}/`;
    return [...runtimeDefinitionDrafts].some(([key,draft])=>{
      if(!key.startsWith(prefix))return false;
      const kind=key.slice(prefix.length).split("/")[0];
      return ["screen","scenario"].includes(kind) && JSON.stringify(definitionValues(kind,draft))!==draft.base;
    });
  }
  function refreshDefinitionControls() {
    for(const form of root.querySelectorAll(".runtime-definition-form")){
      const {kind,definitionId:id}=form.dataset,draft=definitionDraft(kind,id),conflict=definitionConflict(kind,id),invalid=definitionValidation(kind,draft);
      const save=form.querySelector(".runtime-definition-save");if(save)save.disabled=runtimeWorkspaceBlocked(true) || conflict || Boolean(invalid) || id!=="new"&&!definitionDirty(kind,id);
      const feedback=form.querySelector(".runtime-definition-status");if(feedback)feedback.textContent=conflict?"Saved definition changed. Your draft is preserved.":invalid || (definitionDirty(kind,id)?"Unsaved definition":"Saved on this device");
    }
    const begin=root.querySelector(".scenario-begin");if(begin)begin.disabled=Boolean(scenarioBlocker());
    for(const open of root.querySelectorAll(".runtime-open-screen"))open.disabled=!selectedScreen() || runtimeWorkspaceBlocked(true) || runtimeDefinitionDraftPending();
    for(const hint of root.querySelectorAll(".runtime-definition-blocker")){hint.hidden=!runtimeDefinitionDraftPending();hint.textContent="Save or discard runtime definition drafts before opening a screen.";}
  }
  function editRuntimeDefinition(kind,id="new") {
    state.runtimeEditor={kind,id};definitionDraft(kind,id);saveView();render();root.querySelector('[data-design-focus="runtime-definition/title"]')?.focus();
  }
  function runtimeDefinitionEditor() {
    const editor=state.runtimeEditor;if(!editor)return null;
    const {kind,id}=editor,draft=definitionDraft(kind,id),form=el("div","runtime-definition-form");form.dataset.kind=kind;form.dataset.definitionId=id;
    form.append(el("h3","",`${id==="new"?"New":"Edit"} ${kind}`));
    const field=(name,label,{multiline=false,maxLength=2000,placeholder=""}={})=>{
      const wrap=el("label","feature-field",label),input=el(multiline?"textarea":"input");if(!multiline)input.type="text";else input.rows=name==="steps"?4:3;
      input.maxLength=maxLength;input.value=draft[name];input.placeholder=placeholder;input.disabled=runtimeWorkspaceBlocked(true);input.setAttribute("aria-label",`${kind==="screen"?"Screen":"Scenario"} ${label.toLowerCase()}`);input.dataset.designFocus=`runtime-definition/${name}`;
      input.addEventListener("input",()=>{draft[name]=input.value;saveView();refreshDefinitionControls();});wrap.append(input);return wrap;
    };
    form.append(field("title","Title",{maxLength:80}));
    if(kind==="screen"){
      const label=el("label","feature-field","Target"),select=el("select");select.setAttribute("aria-label","Screen target");select.dataset.designFocus="runtime-definition/target";select.disabled=runtimeWorkspaceBlocked(true);
      const none=el("option","","Choose a target…");none.value="";select.append(none);const targets=state.runtime?.targets || [];
      for(const target of targets){const option=el("option","",target.label || target.id);option.value=target.id;select.append(option);}
      if(draft.targetId&&!targets.some(target=>target.id===draft.targetId)){const missing=el("option","",`${draft.targetId} · unavailable`);missing.value=draft.targetId;select.append(missing);}
      select.value=draft.targetId;select.addEventListener("change",()=>{draft.targetId=select.value;saveView();refreshDefinitionControls();});label.append(select);form.append(label,field("route","Route",{maxLength:512,placeholder:"/profile"}),el("p","feature-caption","Saved as a route path. Opening the screen is a separate action."));
    }else form.append(field("steps","Steps",{multiline:true,maxLength:6012,placeholder:"Enter a value\nSelect Save\nCheck the result"}),el("p","feature-caption","One step per line. You perform these steps manually."),field("expectedOutcome","Expected result",{multiline:true,maxLength:2000}));
    const feedback=el("p","runtime-definition-status feature-caption");feedback.setAttribute("role","status");feedback.textContent=definitionConflict(kind,id)?"Saved definition changed. Your draft is preserved.":definitionValidation(kind,draft) || (definitionDirty(kind,id)?"Unsaved definition":"Saved on this device");
    const actions=el("div","feature-form-actions"),save=button(`Save ${kind}`,()=>{
      if(definitionValidation(kind,draft)||definitionConflict(kind,id))return;
      const input=definitionValues(kind,draft);input.title=input.title.trim();if(kind==="scenario")input.steps=draft.steps.split("\n").map(step=>step.trim()).filter(Boolean);
      if(kind==="scenario" && id!=="new")delete input.screenId;
      if(id==="new")pendingRuntimeDefinition={kind,digest:JSON.stringify(definitionValues(kind,input)),revision:state.runtimeWorkspace.revision};
      runtimeWorkspaceAction(`${id==="new"?"create":"update"}${kind==="screen"?"Screen":"Scenario"}`,{...(id!=="new"?{id}:{}),input});
    },"button primary runtime-definition-save");save.dataset.designFocus="runtime-definition/save";save.disabled=runtimeWorkspaceBlocked(true)||Boolean(definitionValidation(kind,draft))||definitionConflict(kind,id)||id!=="new"&&!definitionDirty(kind,id);
    const discard=button(definitionConflict(kind,id)?"Reload saved definition":"Discard draft",()=>{runtimeDefinitionDrafts.delete(definitionKey(kind,id));pendingRuntimeDefinition=null;if(id==="new")state.runtimeEditor=null;saveView();render();},"button");
    const close=button("Close",()=>{state.runtimeEditor=null;saveView();render();},"text-button");close.title="Keep this draft for later";actions.append(save,discard,close);form.append(feedback,actions);return form;
  }
  function runtimeWorkspaceNotice() {
    const current=state.runtimeWorkspace,wrap=el("div","runtime-workspace-notice");
    if(current?.error)wrap.append(note(current.error,"error"));
    if(["saving","error","unavailable"].includes(current?.storage?.status)){
      wrap.append(note(current.storage.message || (current.storage.status==="saving"?"Saving runtime workspace…":"Runtime workspace could not be saved."),current.storage.status==="saving"?"":"warning"));
      if(current.storage.status!=="saving")wrap.append(button("Retry runtime storage",()=>runtimeWorkspaceAction("retry"),"button small","refresh"));
    }
    if(!recordingRun()){const replay=replayStorageNotice();if(replay.childElementCount)wrap.append(replay);}
    const matrix=matrixStorageNotice();if(matrix.childElementCount)wrap.append(matrix);
    return wrap;
  }
  function scenarioBlocker() {
    if(runtimeWorkspaceBlocked(true))return recordingRun()?"A manual observation is already recording.":"Finish the current operation before beginning.";
    const screen=selectedScreen(),scenario=selectedScenario(),runtime=state.runtime;
    if(!screen || !scenario)return "Choose a saved screen and scenario.";
    if(featureDraftChanged(activeFeature()?.id) || runtimeDefinitionDraftPending())return "Save or discard the definition draft before beginning.";
    if(runtime?.status!=="connected" || runtime.target?.id!==screen.targetId)return "Open this screen to connect its target.";
    if(runtime.pageConnected!==true || !runtime.documentId || !Number.isSafeInteger(runtime.pageVersion) || runtime.pageVersion<=0)return "Waiting for the instrumented page.";
    if(runtime.pagePath!==screen.route)return "Open this screen to reach its saved route.";
    return "";
  }
  function runtimeFeatureControls() {
    const box=el("div","runtime-feature-controls");if(!state.runtimeWorkspace || !activeFeature())return box;
    const screen=selectedScreen(),scenario=selectedScenario(),row=el("div","runtime-screen-row");
    const screenLabel=el("label","runtime-choice-label","Screen"),screens=el("select");screens.setAttribute("aria-label","Feature screen");screens.dataset.designFocus="runtime/screen";screens.disabled=runtimeWorkspaceBlocked(true);
    const none=el("option","","Choose a screen…");none.value="";screens.append(none);for(const item of featureScreens()){const option=el("option","",item.title);option.value=item.id;screens.append(option);}screens.value=screen?.id || "";
    screens.addEventListener("change",()=>runtimeWorkspaceAction("select",{screenId:screens.value || null,scenarioId:null}));screenLabel.append(screens);
    const open=button("Open screen",()=>runtimeWorkspaceAction("openScreen",{screenId:screen.id}),"button small runtime-open-screen");open.disabled=!screen || runtimeWorkspaceBlocked(true) || runtimeDefinitionDraftPending();open.dataset.designFocus="runtime/open-screen";row.append(screenLabel,open);box.append(row);
    if(screen){
      const route=el("p","runtime-screen-route feature-caption");route.append(el("code","",screen.route),document.createTextNode(` · ${state.runtime?.targets?.find(target=>target.id===screen.targetId)?.label || screen.targetId}`));box.append(route);
      const scenarioRow=el("div","runtime-scenario-row"),label=el("label","runtime-choice-label","Scenario"),select=el("select");select.setAttribute("aria-label","Manual scenario");select.dataset.designFocus="runtime/scenario";select.disabled=runtimeWorkspaceBlocked(true);
      const empty=el("option","","Choose a scenario…");empty.value="";select.append(empty);for(const item of state.runtimeWorkspace.scenarios.filter(item=>item.screenId===screen.id&&!item.archived)){const option=el("option","",item.title);option.value=item.id;select.append(option);}select.value=scenario?.id || "";
      select.addEventListener("change",()=>runtimeWorkspaceAction("select",{screenId:screen.id,scenarioId:select.value || null}));label.append(select);
      const matrix=activeMatrix(),replaying=Boolean(recordingRun() && replaySession()?.busy && savedRunReplay(recordingRun()).record?.status==="running");
      const begin=button(matrix?"Running matrix":replaying?"Replaying recipe":recordingRun()?"Recording manually":"Begin observation",()=>runtimeWorkspaceAction("beginRun",{scenarioId:scenario.id}),"button small scenario-begin","inspect");begin.disabled=Boolean(scenarioBlocker());begin.dataset.designFocus="runtime/begin-observation";scenarioRow.append(label,begin);box.append(scenarioRow);
      box.append(el("p","feature-caption",matrix?"Conditions run in order. Stop matrix keeps recorded evidence.":replaying?"Recipe steps are running. Stop replay in the Inspector.":recordingRun()?"Perform the steps in the app. Finish or cancel in the Inspector.":scenario?scenarioBlocker() || "You perform the steps. Foundation records available runtime evidence.":"Scenarios are manual observation guides."));
    }
    const draftHint=el("p","runtime-definition-blocker feature-caption warning","Save or discard runtime definition drafts before opening a screen.");draftHint.hidden=!runtimeDefinitionDraftPending();box.append(draftHint,runtimeWorkspaceNotice());return box;
  }
  function captureRunBlocker() {
    if(!recordingRun())return "Begin an observation before capturing.";
    if(state.runtimeCaptures?.projectId!==state.project?.id || state.runtimeCaptures?.available!==true)return "Visual capture is unavailable in this workspace. You can finish without an image.";
    if(state.mode!=="Refine")return "Open the running preview to capture its visible canvas.";
    if(state.runtime?.status!=="connected" || !state.runtime.pageConnected)return "Reconnect the running preview before capturing.";
    if(state.designInspect)return "Turn Inspect off before capturing.";
    if(runtimeWorkspaceBlocked())return state.runtimeWorkspace?.busy==="captureAndFinishRun" ? "Capturing the visible preview…" : "Wait for the current operation to finish.";
    return "";
  }
  function safeReplayChoice(value) {
    const id=item=>typeof item==="string" && item.length<=200 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(item);
    if(!value || value.version!==1 || ![value.projectId,value.featureId,value.screenId,value.runId].every(id) || !(value.recipeId===null || id(value.recipeId)) || !["system","reduce"].includes(value.motion) || !(value.registrationId===null || /^[a-f0-9]{32}$/.test(value.registrationId)) || !(value.catalogDigest===null || /^[a-f0-9]{64}$/.test(value.catalogDigest)))return null;
    return {version:1,projectId:value.projectId,featureId:value.featureId,screenId:value.screenId,runId:value.runId,recipeId:value.recipeId,registrationId:value.registrationId,catalogDigest:value.catalogDigest,motion:value.motion};
  }
  function replayChoiceKey(run) { return JSON.stringify([state.project?.id,run.feature.id,run.screen.id,run.id]); }
  function replayChoice(run) {
    return replayChoices.get(replayChoiceKey(run)) || {version:1,projectId:state.project?.id,featureId:run.feature.id,screenId:run.screen.id,runId:run.id,recipeId:null,registrationId:null,catalogDigest:null,motion:"system"};
  }
  function updateReplayChoice(run,patch) {
    if(recordingRun()?.id!==run.id || runtimeReplayBusy())return;
    const value=safeReplayChoice({...replayChoice(run),...patch});if(!value)return;
    const key=replayChoiceKey(run);replayChoices.delete(key);replayChoices.set(key,value);
    while(replayChoices.size>40)replayChoices.delete(replayChoices.keys().next().value);
    saveView();updateRuntimeView();
  }
  function replayCatalog() {
    const catalog=state.runtime?.replayCatalog;
    const text=value=>typeof value==="string" && value.length>0 && value.length<=500;
    const id=value=>typeof value==="string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
    if(!catalog || catalog.schemaVersion!==1 || !/^[a-f0-9]{32}$/.test(catalog.registrationId || "") || !/^[a-f0-9]{64}$/.test(catalog.digest || "") || !Array.isArray(catalog.recipes) || catalog.recipes.length>12 || new Set(catalog.recipes.map(item=>item?.id)).size!==catalog.recipes.length || catalog.recipes.some(item=>!item || !id(item.id) || !text(item.title) || !text(item.route) || !id(item.fixture?.id) || !text(item.fixture?.label) || !Array.isArray(item.steps) || item.steps.length>12 || new Set(item.steps.map(step=>step?.id)).size!==item.steps.length || item.steps.some(step=>!id(step?.id) || !text(step?.title))))return null;
    return catalog;
  }
  function replaySession() {
    const value=state.runtimeReplays;
    return value?.schemaVersion===1 && value.projectId===state.project?.id && Number.isSafeInteger(value.revision) && value.revision>=0 && Array.isArray(value.replays) && value.replays.length<=40 ? value:null;
  }
  function runtimeReplayBusy() {
    const session=replaySession();
    return Boolean(pendingReplayStart && pendingReplayStart.projectId===state.project?.id || session?.busy || session?.replays.some(record=>record?.status==="running"));
  }
  function savedRunReplay(run) {
    const session=replaySession();
    if(!session)return {reason:state.runtimeReplays?"Replay evidence is unavailable.":""};
    const records=session.replays.filter(record=>record?.runId===run.id);
    if(!records.length)return {reason:""};
    if(records.length!==1)return {reason:"Replay evidence is ambiguous."};
    const record=records[0],binding=record.binding,recipe=record.recipe;
    const sameSources=(left,right)=>Array.isArray(left)&&Array.isArray(right)&&left.length===right.length&&left.every((item,index)=>item?.path===right[index].path&&item.revision===right[index].revision);
    const sameStrings=(left,right)=>Array.isArray(left)&&Array.isArray(right)&&left.length===right.length&&left.every((item,index)=>item===right[index]);
    const unit=value=>value && typeof value.id==="string" && ["pending","running","completed","failed","cancelled","interrupted"].includes(value.status) && ["not-started","unknown"].includes(value.effects);
    if(typeof record.id!=="string" || typeof record.executionId!=="string" || record.featureId!==run.feature.id || record.screenId!==run.screen.id || record.scenarioId!==run.scenario.id || record.sourceRelationship!=="unverified" || binding?.startedAt!==run.startedAt || binding.definitionRevision!==run.definitionRevision || !binding.runtime || !["targetId","session","viewId","documentId","route","pageVersion"].every(key=>binding.runtime[key]===run.runtime[key]) || !sameSources(binding.sources,run.sources) || !sameStrings(binding.dirtyPaths,run.dirtyPaths) || !["running","completed","failed","cancelled","interrupted"].includes(record.status) || !recipe || typeof recipe.title!=="string" || recipe.route!==run.screen.route || typeof recipe.fixture?.label!=="string" || !Array.isArray(recipe.steps) || recipe.steps.length>12 || !Array.isArray(record.steps) || record.steps.length!==recipe.steps.length || record.steps.some((step,index)=>!unit(step)||step.id!==recipe.steps[index]?.id||typeof recipe.steps[index]?.title!=="string") || !unit(record.prepare) || record.prepare.id!=="prepare" || !["light","dark"].includes(record.requested?.theme) || !["system","reduce"].includes(record.requested?.motion) || ![390,768,960].includes(record.requested?.viewportWidthCss) || record.requested?.viewportHeightCss!==680 || record.status==="completed" && [record.prepare,...record.steps].some(step=>step.status!=="completed"))return {reason:"Replay evidence does not match this observation."};
    return {record,reason:""};
  }
  function replayReasonText(reason) {
    return {cancelled:"Replay was stopped. Earlier actions may remain.",timeout:"The app did not finish a replay step in time. Earlier actions may remain.","runtime-changed":"The runtime changed during replay. Begin a new observation.","recipe-changed":"The app recipe changed during replay. Review its current definition.","step-failed":"An app callback failed. Later steps were not run.","storage-failed":"Replay evidence could not be saved. Retry storage; no steps will run again.","host-restarted":"Foundation restarted. The replay was not resumed.","host-disposed":"Foundation closed. The replay was not resumed.","source-changed":"Saved source changed during replay. Begin a new observation.","context-changed":"The observation context changed. Later steps were not run.","transport-failed":"The runtime connection could not confirm replay progress.","preview-changed":"The running preview changed or was hidden. Later steps were not run."}[reason] || "Replay ended without a confirmed result.";
  }
  function replayBlockedText() {
    return {"reload-required":"Finish this observation, then reopen its screen before replaying.","invalid-catalog":"The app’s replay recipes could not be validated. Update its registration and reopen the screen."}[state.runtime?.replayBlocked] || "Replay is unavailable for this app. Reopen the screen to refresh its registration.";
  }
  function replayStartBlocker(run) {
    const session=replaySession(),catalog=replayCatalog(),choice=replayChoice(run),view=savedRunReplay(run);
    if(!state.trusted || !state.project)return "Trust this workspace to replay an app recipe.";
    if(view.record)return "One replay is kept per observation. Begin a new observation to run another.";
    if(view.reason)return view.reason;
    if(!session)return "Recipe replay is unavailable in this workspace.";
    if(["saving","error","unavailable"].includes(session.storage?.status))return session.storage.message || "Restore replay storage before starting.";
    if(runtimeReplayBusy())return "A recipe replay is already active.";
    if(runtimeWorkspaceBlocked() || run.id!==recordingRun()?.id)return "Begin an observation before replaying.";
    if(run.feature.id!==activeFeature()?.id || run.screen.id!==selectedScreen()?.id || run.scenario.id!==selectedScenario()?.id)return "Select this observation’s feature, screen and scenario before replaying.";
    if(state.mode!=="Refine" || !isRuntimePreview())return "Open the running preview before replaying.";
    if(state.runtime?.status!=="connected" || !state.runtime.pageConnected || !["session","viewId","documentId","pageVersion"].every(key=>state.runtime[key]===run.runtime[key]) || state.runtime.pagePath!==run.runtime.route)return "Reconnect this screen and begin a new observation.";
    if(state.runtime.replayBlocked)return replayBlockedText();
    if(state.runtime.capabilities?.scenarioReplay!==true || !catalog)return "This app has not registered replay recipes.";
    if(!catalog.recipes.some(recipe=>recipe.route===run.screen.route))return "No app-authored recipes are available for this screen.";
    if(!choice.recipeId)return "Choose an app-authored recipe.";
    if(choice.registrationId!==catalog.registrationId || choice.catalogDigest!==catalog.digest || !catalog.recipes.some(recipe=>recipe.id===choice.recipeId && recipe.route===run.screen.route))return "The selected recipe changed or is unavailable. Choose a current recipe.";
    if(state.designInspect)return "Turn Inspect off before replaying.";
    if(![390,768,960].includes(Number(state.designWidth)) || !["light","dark"].includes(state.designTheme))return "Choose a supported preview size and theme.";
    return "";
  }
  function runtimeReplayAction(action,run,record) {
    if(!state.trusted || !state.project)return;
    if(action==="start") {
      if(replayStartBlocker(run))return;
      const choice=replayChoice(run),session=replaySession();
      pendingReplayStart={projectId:state.project.id,runId:run.id,revision:session.revision};
      vscode.postMessage({type:"runtimeReplay",action,projectId:state.project.id,runId:run.id,expectedRevision:session.revision,recipeId:choice.recipeId,catalogDigest:choice.catalogDigest,registrationId:choice.registrationId,requested:{theme:state.designTheme,motion:choice.motion,viewportWidthCss:Number(state.designWidth),viewportHeightCss:680}});
    } else if(action==="cancel") {
      if(!record || record.status!=="running" || savedRunReplay(run).record?.executionId!==record.executionId || pendingReplayCancel===record.executionId)return;
      pendingReplayCancel=record.executionId;vscode.postMessage({type:"runtimeReplay",action,projectId:state.project.id,id:record.id,executionId:record.executionId});
    } else if(action==="retry") {
      if(replaySession()?.busy || pendingReplayStart || !["error","unavailable"].includes(replaySession()?.storage?.status))return;
      vscode.postMessage({type:"runtimeReplay",action,projectId:state.project.id});
    }
    updateRuntimeView();
  }
  function replayStorageNotice() {
    const session=replaySession(),box=el("div","runtime-replay-notice");
    if(session?.error)box.append(el("p","feature-caption warning",session.error));
    if(["saving","error","unavailable"].includes(session?.storage?.status)){
      const message=el("p","feature-caption warning",session.storage.message || (session.storage.status==="saving"?"Saving replay evidence…":"Replay evidence could not be saved."));message.setAttribute("role","status");box.append(message);
      if(session.storage.status!=="saving"){const retry=button("Retry replay storage",()=>runtimeReplayAction("retry"),"button small");retry.disabled=Boolean(session.busy || pendingReplayStart);retry.dataset.designFocus="runtime-replay/retry-storage";box.append(retry);}
    }
    return box;
  }
  function replayConditionFacts(record) {
    const requested=el("dl","request-facts replay-condition-facts"),observed=record.observed;
    for(const [label,value] of [["Requested viewport",`${record.requested.viewportWidthCss} × ${record.requested.viewportHeightCss} CSS px`],["Requested app theme",record.requested.theme==="dark"?"Dark":"Light"],["Requested app motion",record.requested.motion==="reduce"?"Reduced":"Follow system"]])requested.append(el("dt","",label),el("dd","",value));
    const facts=el("dl","request-facts replay-condition-facts"),scale=value=>new Intl.NumberFormat(undefined,{maximumFractionDigits:3,useGrouping:false}).format(value);
    for(const [label,value] of [["Observed viewport",observed?`${observed.viewportWidthCss} × ${observed.viewportHeightCss} CSS px`:"Not recorded"],["Device scale",observed?`${scale(observed.deviceScaleFactor)}×`:"Not recorded"],["Browser color preference",observed?.colorSchemePreference || "Not recorded"],["Browser motion preference",observed?.reducedMotionPreference || "Not recorded"]])facts.append(el("dt","",label),el("dd","",value));
    return [requested,el("p","scenario-expected-label","Last completed step conditions"),facts,el("p","feature-caption","App theme and motion are requested from the recipe. Browser media preferences are observed separately; they are not emulated.")];
  }
  function replayEvidence(record,key) {
    const box=el("div","runtime-replay-evidence");box.dataset.replayId=record.id;box.dataset.replayStatus=record.status;
    const uncertain=record.status==="running" && replaySession()?.busy!==true && ["error","unavailable"].includes(replaySession()?.storage?.status);
    const status=uncertain?"Replay result unconfirmed":{running:"Replay running",completed:"Replay completed",failed:"Replay failed",cancelled:"Replay stopped",interrupted:"Replay interrupted"}[record.status];
    const header=el("div","replay-evidence-heading");header.append(el("strong","",record.recipe.title),el("span",`feature-caption${["failed","interrupted"].includes(record.status)?" warning":""}`,status));box.append(header,el("p","feature-caption",`App-authored recipe · ${record.recipe.fixture.label}`));
    const steps=el("ol","replay-step-list");steps.setAttribute("aria-label","Replay steps");
    for(const [unit,title] of [[record.prepare,"Prepare fixture"],...record.steps.map((step,index)=>[step,record.recipe.steps[index].title])]){
      const row=el("li","replay-step");row.dataset.replayStep=unit.id;row.dataset.stepStatus=unit.status;
      const head=el("div","replay-step-heading");head.append(el("span","",title),el("span","feature-caption",uncertain && unit.status==="running"?"Unconfirmed":{pending:"Not run",running:"Running",completed:"Completed",failed:"Failed",cancelled:"Stopped",interrupted:"Interrupted"}[unit.status]));row.append(head);
      if(unit.startedAt || unit.endedAt || unit.effects==="unknown")row.append(lazyContentDetails("Step evidence",`${key}/${unit.id}/evidence`,()=>{
        const facts=el("dl","request-facts");for(const [label,value] of [["Started",unit.startedAt || "Not recorded"],["Finished",unit.endedAt || "Not recorded"],["Effects",unit.effects==="not-started"?"Not started":"May have changed the app"]])facts.append(el("dt","",label),el("dd","",value));return [facts];
      },"content-details replay-step-evidence"));steps.append(row);
    }
    box.append(steps);
    if(record.reason)box.append(el("p",record.reason==="cancelled"?"feature-caption":"feature-caption warning",replayReasonText(record.reason)));
    box.append(el("p","feature-caption","Step completion records app callbacks. Behavioral and visual outcomes are not assessed."));
    box.append(lazyContentDetails("Replay conditions",`${key}/conditions`,()=>replayConditionFacts(record)));
    box.append(lazyContentDetails("Replay provenance",`${key}/provenance`,()=>{
      const facts=el("dl","request-facts replay-provenance");for(const [label,value] of [["Fixture",`${record.recipe.fixture.label} · ${record.recipe.fixture.id}`],["Recipe",record.recipe.id],["Catalog",record.recipe.catalogDigest],["Registration",record.recipe.registrationId],["Execution",record.executionId],["Saved-source relationship","Unverified"]])facts.append(el("dt","",label),el("dd","",value));return [facts,el("p","feature-caption","Requests belong to the observation interval. A causal link to individual replay steps is unconfirmed.")];
    }));return box;
  }
  function savedReplayDetails(run,key) {
    const view=savedRunReplay(run);
    if(view.reason)return el("p","feature-caption warning",view.reason);
    return view.record?lazyContentDetails("Recipe replay",`${key}/replay`,()=>[replayEvidence(view.record,`${key}/replay/${view.record.id}`)],"content-details saved-replay-details"):null;
  }
  function scenarioReplayPanel(run) {
    const section=el("section","scenario-replay");section.setAttribute("aria-label","Scenario replay");section.append(el("h3","","App-authored recipe"));
    const view=savedRunReplay(run),record=view.record;
    if(record){
      const evidence=replayEvidence(record,`replay/${record.id}`);if(record.status!=="running"){evidence.dataset.designFocus=`runtime-replay/${run.id}/primary`;evidence.tabIndex=-1;}section.append(evidence);
      if(record.status==="running"){
        const stopping=pendingReplayCancel===record.executionId,stop=button(stopping?"Stopping replay…":"Stop replay",()=>runtimeReplayAction("cancel",run,record),"button");stop.disabled=replaySession()?.busy!==true && ["error","unavailable"].includes(replaySession()?.storage?.status);stop.setAttribute("aria-disabled",String(stopping || stop.disabled));stop.dataset.designFocus=`runtime-replay/${run.id}/primary`;stop.setAttribute("aria-label","Stop replay");section.append(stop);
        if(stopping)section.append(el("p","feature-caption","Stop requested. Waiting for the current app callback to settle."));
      } else section.append(el("p","feature-caption","Finish this observation, or capture its visible result. Begin a new observation to replay again."));
      if(state.runtime?.replayBlocked)section.append(el("p","feature-caption warning",replayBlockedText()));
      section.append(replayStorageNotice());return section;
    }
    const catalog=replayCatalog(),choice=replayChoice(run),recipes=(catalog?.recipes || []).filter(recipe=>recipe.route===run.screen.route),validChoice=choice.registrationId===catalog?.registrationId && choice.catalogDigest===catalog?.digest;
    const label=el("label","feature-field","Recipe"),select=el("select");select.setAttribute("aria-label","Replay recipe");select.dataset.designFocus=`runtime-replay/${run.id}/recipe`;select.disabled=runtimeReplayBusy() || !recipes.length;
    const none=el("option","","Choose a recipe…");none.value="";select.append(none);for(const recipe of recipes){const option=el("option","",recipe.title);option.value=recipe.id;select.append(option);}
    const missing=Boolean(choice.recipeId && (!validChoice || !recipes.some(recipe=>recipe.id===choice.recipeId)));
    if(missing){const option=el("option","","Selected recipe unavailable — choose again");option.value="unavailable-selection";option.disabled=true;select.append(option);}
    select.value=missing?"unavailable-selection":choice.recipeId || "";
    select.addEventListener("change",()=>updateReplayChoice(run,{recipeId:select.value || null,registrationId:select.value?catalog.registrationId:null,catalogDigest:select.value?catalog.digest:null}));label.append(select);section.append(label);
    const recipe=!missing && recipes.find(item=>item.id===choice.recipeId);
    if(recipe){
      section.append(el("p","feature-caption",`Fixture · ${recipe.fixture.label}`));
      const list=el("ol","scenario-steps");list.append(el("li","",`Prepare fixture: ${recipe.fixture.label}`));for(const step of recipe.steps)list.append(el("li","",step.title));
      section.append(contentDetails("Recipe details",`replay-choice/${run.id}/${catalog.digest}/${recipe.id}`,[list,el("p","feature-caption","The app supplies these steps. Manual scenario instructions are not executed.")]));
    }
    const motionLabel=el("label","feature-field","App motion"),motion=el("select");motion.setAttribute("aria-label","Replay app motion");motion.dataset.designFocus=`runtime-replay/${run.id}/motion`;motion.disabled=runtimeReplayBusy();
    for(const [value,title] of [["system","Follow system"],["reduce","Reduced"]]){const option=el("option","",title);option.value=value;motion.append(option);}motion.value=choice.motion;motion.addEventListener("change",()=>updateReplayChoice(run,{motion:motion.value}));motionLabel.append(motion);section.append(motionLabel);
    const start=button(pendingReplayStart?.runId===run.id?"Starting replay…":"Replay recipe",()=>runtimeReplayAction("start",run),"button primary");const blocked=Boolean(replayStartBlocker(run));start.disabled=blocked && pendingReplayStart?.runId!==run.id;start.setAttribute("aria-disabled",String(blocked));start.setAttribute("aria-label","Replay recipe");start.dataset.designFocus=`runtime-replay/${run.id}/primary`;start.setAttribute("aria-busy",String(pendingReplayStart?.runId===run.id));section.append(start);
    const reason=replayStartBlocker(run);if(reason){const hint=el("p","feature-caption replay-guidance",reason);hint.setAttribute("role","status");section.append(hint);}
    section.append(el("p","feature-caption",`${state.designWidth} × 680 CSS px · ${state.designTheme==="dark"?"Dark":"Light"} requested. Replay starts by resetting the app fixture.`),replayStorageNotice());return section;
  }
  const suiteStates=[['idle','Idle'],['loading','Loading'],['success','Success'],['error','Error'],['offline','Offline']];
  function suiteStateLabel(value) {return suiteStates.find(([id])=>id===value)?.[1] || 'Choose state';}
  function suiteSession() {const value=state.runtimeStateSuites;return value?.schemaVersion===1 && value.projectId===state.project?.id && Number.isSafeInteger(value.revision) && Array.isArray(value.suites)?value:null;}
  function suiteOwnerKey(owner=matrixOwner()) {return owner?JSON.stringify([owner.projectId,owner.featureId,owner.screenId,owner.scenarioId]):'';}
  function safeSuiteDraft(value) {
    const id=text=>typeof text==='string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(text),subset=(items,allowed)=>Array.isArray(items)&&items.length<=allowed.length&&new Set(items).size===items.length&&items.every(item=>allowed.includes(item));
    if(!value || value.version!==1 || ![value.projectId,value.featureId,value.screenId,value.scenarioId].every(id) || !(value.id===null || id(value.id)) || !Number.isSafeInteger(value.revision) || value.revision<0 || typeof value.title!=='string' || value.title.length>80 || !Array.isArray(value.states) || value.states.length>5 || !value.states.every(row=>row && ['', 'idle','loading','success','error','offline'].includes(row.state) && (row.recipeId===null || id(row.recipeId)) && (row.catalogDigest===null || /^[a-f0-9]{64}$/.test(row.catalogDigest))) || !subset(value.widths,[390,768,960]) || !subset(value.themes,['light','dark']) || !subset(value.motions,['system','reduce']) || typeof value.captureEach!=='boolean' || typeof value.editing!=='boolean')return null;
    return {version:1,projectId:value.projectId,featureId:value.featureId,screenId:value.screenId,scenarioId:value.scenarioId,id:value.id,revision:value.revision,title:value.title,states:value.states.map(row=>({state:row.state,recipeId:row.recipeId,catalogDigest:row.catalogDigest})),widths:[390,768,960].filter(item=>value.widths.includes(item)),themes:['light','dark'].filter(item=>value.themes.includes(item)),motions:['system','reduce'].filter(item=>value.motions.includes(item)),captureEach:value.captureEach,editing:value.editing};
  }
  function suiteDraft() {return suiteDrafts.get(suiteOwnerKey()) || null;}
  function suiteDefinitionDraft(definition,editing=false) {
    const owner=matrixOwner();if(!owner)return null;
    return safeSuiteDraft({...owner,version:1,id:definition?.id || null,revision:definition?.revision || 0,title:definition?.title || '',states:definition?definition.states.map(row=>({state:row.state,recipeId:row.recipe.id,catalogDigest:row.recipe.catalogDigest})):[{state:'',recipeId:null,catalogDigest:null}],widths:definition?[...new Set(definition.requested.map(item=>item.viewportWidthCss))]:[[390,768,960].includes(Number(state.designWidth))?Number(state.designWidth):960],themes:definition?[...new Set(definition.requested.map(item=>item.theme))]:[state.designTheme==='dark'?'dark':'light'],motions:definition?[...new Set(definition.requested.map(item=>item.motion))]:['system'],captureEach:definition?.captureEach || false,editing});
  }
  function setSuiteDraft(value,render=true) {const next=safeSuiteDraft(value);if(!next)return;const key=suiteOwnerKey(next);suiteDrafts.delete(key);suiteDrafts.set(key,next);while(suiteDrafts.size>16)suiteDrafts.delete(suiteDrafts.keys().next().value);saveView();if(render)updateRuntimeView();}
  function updateSuiteDraft(patch,render=true) {if(runtimeMatrixBusy() || pendingSuiteSave)return;const draft=suiteDraft();if(draft)setSuiteDraft({...draft,...patch},render);}
  function currentSuite() {const draft=suiteDraft();return draft?.id?suiteSession()?.suites.find(item=>item.id===draft.id):null;}
  function suiteValueDigest(value) {return JSON.stringify({title:value.title.trim(),states:value.states.map(row=>({state:row.state,recipeId:row.recipeId,catalogDigest:row.catalogDigest})),requested:matrixRequested(value),captureEach:value.captureEach});}
  function suiteDraftChanged() {const draft=suiteDraft(),saved=currentSuite();return Boolean(draft && (!saved || suiteValueDigest(draft)!==suiteValueDigest(suiteDefinitionDraft(saved))));}
  function suiteConflict() {const draft=suiteDraft(),saved=currentSuite();return Boolean(draft?.id && (!saved || draft.revision!==saved.revision));}
  function suiteSaveBlocker(asNew=false) {
    const session=suiteSession(),draft=suiteDraft(),catalog=replayCatalog();if(!state.trusted)return 'Trust this workspace to save state suites.';
    if(!session || session.storage?.status!=='saved')return session?.storage?.message || 'Restore suite storage before saving.';
    if(runtimeMatrixBusy() || runtimeReplayBusy() || recordingRun() || pendingSuiteSave)return 'Finish the active operation before saving a suite.';
    if(!draft)return 'Create or choose a suite.';if(!asNew && suiteConflict())return 'This saved suite changed. Reload it or save your draft as new.';
    if(!draft.title.trim() || draft.title.trim().length>80)return 'Name this suite, up to 80 characters.';
    if(!draft.states.length || draft.states.some(row=>!row.state))return 'Choose a state for every row.';
    if(new Set(draft.states.map(row=>row.state)).size!==draft.states.length)return 'Choose each state once.';
    if(!catalog || draft.states.some(row=>!row.recipeId || row.catalogDigest!==catalog.digest || !catalog.recipes.some(recipe=>recipe.id===row.recipeId && recipe.route===selectedScreen()?.route)))return 'Choose a current app recipe for every state.';
    if(new Set(draft.states.map(row=>row.recipeId)).size!==draft.states.length)return 'Choose a different recipe for each state.';
    const count=matrixRequested(draft).length*draft.states.length;if(!count || count>12)return 'Choose shared conditions for 1–12 total runs.';
    return '';
  }
  function suiteStartBlocker() {
    const session=matrixSession(),draft=suiteDraft(),saved=currentSuite(),catalog=replayCatalog();
    if(!saved || draft?.editing || suiteDraftChanged())return 'Save the suite before running it.';
    const blocked=suiteSaveBlocker();if(blocked)return blocked;
    if(session?.storage?.status!=='saved')return 'Restore matrix storage before running this suite.';
    const unavailable=scenarioBlocker();if(unavailable)return unavailable;
    if(state.mode!=='Refine' || !isRuntimePreview())return 'Open the running preview before running this suite.';
    if(state.runtime?.replayBlocked)return replayBlockedText();
    if(state.runtime?.capabilities?.scenarioReplay!==true || !catalog)return 'This app has not registered replay recipes.';
    if(saved.captureEach && (state.runtimeCaptures?.projectId!==state.project?.id || state.runtimeCaptures?.available!==true))return 'Pixel capture is unavailable. Edit the suite to continue without images.';
    return '';
  }
  function suiteSave(asNew=false) {
    if(suiteSaveBlocker(asNew))return;const draft=suiteDraft(),session=suiteSession(),catalog=replayCatalog(),owner=matrixOwner();
    const value={...owner,title:draft.title.trim(),states:draft.states.map(row=>({state:row.state,recipeId:row.recipeId})),requested:matrixRequested(draft),captureEach:draft.captureEach};
    pendingSuiteSave={projectId:state.project.id,ownerKey:suiteOwnerKey(),revision:session.revision,id:asNew?null:draft.id,existingIds:session.suites.map(item=>item.id),digest:suiteValueDigest(draft)};
    vscode.postMessage({type:'runtimeStateSuite',action:'save',...value,expectedRevision:session.revision,featureRevision:state.features.revision,workspaceRevision:state.runtimeWorkspace.revision,registrationId:catalog.registrationId,catalogDigest:catalog.digest,...(!asNew && draft.id?{id:draft.id,suiteRevision:draft.revision}:{})});updateRuntimeView();
  }
  function suiteRun() {
    if(suiteStartBlocker())return;const saved=currentSuite(),catalog=replayCatalog();pendingMatrixStart={projectId:state.project.id,revision:matrixSession().revision,suiteId:saved.id,title:saved.title};lastMatrixId=null;
    vscode.postMessage({type:'runtimeMatrix',action:'start',...matrixOwner(),expectedRevision:matrixSession().revision,featureRevision:state.features.revision,workspaceRevision:state.runtimeWorkspace.revision,suiteId:saved.id,suiteRevision:saved.revision,suiteStoreRevision:suiteSession().revision,registrationId:catalog.registrationId,catalogDigest:catalog.digest});updateRuntimeView();
  }
  function suiteStorageNotice() {
    const session=suiteSession(),box=el('div','matrix-storage-notice');if(session?.error)box.append(el('p','feature-caption warning',session.error));
    if(session && session.storage?.status!=='saved'){box.append(el('p','feature-caption warning',session.storage?.message || 'Suite storage is unavailable.'));
      if(['error','unavailable'].includes(session.storage?.status)){const retry=button('Retry suite storage',()=>vscode.postMessage({type:'runtimeStateSuite',action:'retry',projectId:state.project.id}),'button small');retry.disabled=runtimeMatrixBusy() || Boolean(pendingSuiteSave);box.append(retry);}}
    return box;
  }
  function refreshSuiteControls() {
    const panel=root.querySelector('.state-suite'),draft=suiteDraft();if(!panel || !draft)return;
    for(const control of panel.querySelectorAll('[data-suite-save]'))control.disabled=Boolean(suiteSaveBlocker(control.dataset.suiteSave==='new')) || control.dataset.suiteSave==='update' && !suiteDraftChanged();
    const status=panel.querySelector('.suite-draft-status');if(status)status.textContent=pendingSuiteSave?'Saving suite…':suiteSaveBlocker() || (suiteDraftChanged()?'Unsaved changes':'Saved on this device');
  }
  function suiteConditions(draft,disabled) {
    const fields=el('div','suite-conditions');fields.append(el('h4','','Shared conditions'));
    for(const [name,title,choices] of [['widths','Width',[[390,'390 px','390 pixel width'],[768,'768 px','768 pixel width'],[960,'960 px','960 pixel width']]],['themes','App theme',[['light','Light','Light app theme'],['dark','Dark','Dark app theme']]],['motions','App motion',[['system','Follow system','Follow system app motion'],['reduce','Reduced','Reduced app motion']]]]){
      const group=el('fieldset','matrix-dimension');group.append(el('legend','',title));const options=el('div','matrix-options');for(const [value,text,accessible] of choices){const choice=el('label','matrix-choice'),input=el('input');input.type='checkbox';input.checked=draft[name].includes(value);input.disabled=disabled;input.setAttribute('aria-label',`Suite includes ${accessible}`);input.dataset.designFocus=`suite/${name}/${value}`;input.addEventListener('change',()=>updateSuiteDraft({[name]:input.checked?[...draft[name],value]:draft[name].filter(item=>item!==value)}));choice.append(input,el('span','',text));options.append(choice);}group.append(options);fields.append(group);}
    const capture=el('label','matrix-choice'),checkbox=el('input');checkbox.type='checkbox';checkbox.checked=draft.captureEach;checkbox.disabled=disabled;checkbox.setAttribute('aria-label','Capture each suite result');checkbox.dataset.designFocus='suite/capture';checkbox.addEventListener('change',()=>updateSuiteDraft({captureEach:checkbox.checked}));capture.append(checkbox,el('span','','Capture each result'));fields.append(capture);
    return fields;
  }
  function stateSuitePanel() {
    if(!suiteSession())return null;const section=el('section','state-suite');section.setAttribute('aria-label','State suite');section.append(el('h3','','State suite'));
    const owner=matrixOwner(),draft=suiteDraft(),saved=currentSuite(),locked=runtimeMatrixBusy() || Boolean(pendingSuiteSave),definitions=suiteSession().suites.filter(item=>item.featureId===owner?.featureId && item.screenId===owner?.screenId && item.scenarioId===owner?.scenarioId);
    if(!draft?.editing){const actions=el('div','suite-choice-controls');if(definitions.length){const label=el('label','feature-field','Saved suite'),select=el('select');select.setAttribute('aria-label','Saved suite');select.dataset.designFocus='suite/choose';select.disabled=locked;const none=el('option','','Choose a suite…');none.value='';select.append(none);for(const definition of definitions){const option=el('option','',definition.title);option.value=definition.id;select.append(option);}select.value=saved?.id || '';select.addEventListener('change',()=>{const selected=definitions.find(item=>item.id===select.value);if(selected)setSuiteDraft(suiteDefinitionDraft(selected));else{suiteDrafts.delete(suiteOwnerKey());saveView();updateRuntimeView();}});label.append(select);actions.append(label);}const create=button('New suite',()=>setSuiteDraft(suiteDefinitionDraft(null,true)),'button small');create.disabled=locked;create.dataset.designFocus='suite/new';actions.append(create);section.append(actions);}
    if(!draft){section.append(el('p','feature-caption','Save named states and their app recipes, then run them across shared conditions.'),suiteStorageNotice());return section;}
    const count=matrixRequested(draft).length,total=count*draft.states.length;
    if(draft.editing){
      const form=el('div','suite-editor'),label=el('label','feature-field','Suite name'),name=el('input');name.type='text';name.maxLength=80;name.value=draft.title;name.disabled=locked;name.setAttribute('aria-label','Suite name');name.dataset.designFocus='suite/name';name.addEventListener('input',()=>{updateSuiteDraft({title:name.value},false);refreshSuiteControls();});label.append(name);form.append(label);
      const rows=el('ol','suite-state-rows'),catalog=replayCatalog(),recipes=(catalog?.recipes || []).filter(item=>item.route===selectedScreen()?.route);
      draft.states.forEach((row,index)=>{const item=el('li','suite-state-row');item.dataset.suiteStateIndex=String(index);const stateLabel=el('label','feature-field','State'),select=el('select');select.setAttribute('aria-label',`State ${index+1}`);select.dataset.designFocus=`suite/${index}/state`;select.disabled=locked;for(const [value,title] of [['','Choose a state…'],...suiteStates]){const option=el('option','',title);option.value=value;option.disabled=Boolean(value && draft.states.some((other,i)=>i!==index && other.state===value));select.append(option);}select.value=row.state;select.addEventListener('change',()=>updateSuiteDraft({states:draft.states.map((other,i)=>i===index?{...other,state:select.value}:other)}));stateLabel.append(select);item.append(stateLabel);
        const recipeLabel=el('label','feature-field','App recipe'),recipeSelect=el('select');recipeSelect.setAttribute('aria-label',`Recipe for state ${index+1}`);recipeSelect.dataset.designFocus=`suite/${index}/recipe`;recipeSelect.disabled=locked || !recipes.length;const none=el('option','','Choose a recipe…');none.value='';recipeSelect.append(none);for(const recipe of recipes){const option=el('option','',recipe.title);option.value=recipe.id;option.disabled=draft.states.some((other,i)=>i!==index && other.recipeId===recipe.id);recipeSelect.append(option);}const missing=row.recipeId && (row.catalogDigest!==catalog?.digest || !recipes.some(recipe=>recipe.id===row.recipeId));if(missing){const option=el('option','','Selected recipe · unavailable');option.value='unavailable-selection';recipeSelect.append(option);}recipeSelect.value=missing?'unavailable-selection':row.recipeId || '';recipeSelect.addEventListener('change',()=>{if(recipeSelect.value==='unavailable-selection')return;updateSuiteDraft({states:draft.states.map((other,i)=>i===index?{...other,recipeId:recipeSelect.value || null,catalogDigest:recipeSelect.value?catalog.digest:null}:other)});});recipeLabel.append(recipeSelect);item.append(recipeLabel);
        const recipe=!missing && recipes.find(item=>item.id===row.recipeId);if(recipe)item.append(el('p','feature-caption',`Fixture · ${recipe.fixture.label}`));const remove=button(`Remove state ${index+1}`,()=>updateSuiteDraft({states:draft.states.filter((_,i)=>i!==index)}),'text-button');remove.disabled=locked;remove.dataset.designFocus=`suite/${index}/remove`;item.append(remove);rows.append(item);});form.append(rows);
      const add=button('Add state',()=>updateSuiteDraft({states:[...draft.states,{state:'',recipeId:null,catalogDigest:null}]}),'button small');add.disabled=locked || draft.states.length>=5;add.dataset.designFocus='suite/add';form.append(add,suiteConditions(draft,locked),el('p',total>12?'feature-caption warning':'feature-caption',`${draft.states.length} ${draft.states.length===1?'state':'states'} × ${count} ${count===1?'condition':'conditions'} = ${total} ${total===1?'run':'runs'} · Maximum 12`));
      const status=el('p','feature-caption suite-draft-status');status.setAttribute('role','status');status.textContent=pendingSuiteSave?'Saving suite…':suiteSaveBlocker() || (suiteDraftChanged()?'Unsaved changes':'Saved on this device');form.append(status);
      const actions=el('div','feature-form-actions'),save=button(draft.id?'Update suite':'Save suite',()=>suiteSave(),'button primary');save.dataset.suiteSave=draft.id?'update':'save';save.dataset.designFocus='suite/save';save.disabled=Boolean(suiteSaveBlocker()) || Boolean(draft.id && !suiteDraftChanged());actions.append(save);
      if(draft.id){const copy=button('Save as new',()=>suiteSave(true),'button');copy.dataset.suiteSave='new';copy.dataset.designFocus='suite/save-new';copy.disabled=Boolean(suiteSaveBlocker(true));actions.append(copy);}
      const discard=button(suiteConflict()?'Reload saved suite':'Discard draft',()=>{if(saved)setSuiteDraft(suiteDefinitionDraft(saved));else{suiteDrafts.delete(suiteOwnerKey());saveView();updateRuntimeView();}},'text-button');discard.disabled=locked;discard.dataset.designFocus='suite/discard';actions.append(discard);form.append(actions);section.append(form);
    }else if(saved){
      section.append(el('strong','',saved.title),el('p','feature-caption',`Saved revision ${saved.revision} · ${draft.states.length} states · ${total} runs`));const rows=el('ol','suite-saved-states');for(const row of saved.states)rows.append(el('li','',`${suiteStateLabel(row.state)} · ${row.recipe.title}`));section.append(rows);
      section.append(lazyContentDetails(`${count} shared ${count===1?'condition':'conditions'}`,`suite/${saved.id}/conditions`,()=>{const list=el('ul','matrix-selected-conditions');for(const requested of saved.requested)list.append(el('li','',matrixConditionLabel(requested)));return [list,el('p','feature-caption',saved.captureEach?'Capture each result · Images stay on this device.':'Pixel captures are not requested.')];}));
      const actions=el('div','feature-form-actions'),run=button(pendingMatrixStart?.suiteId===saved.id?'Starting suite…':'Run suite',suiteRun,'button primary');run.setAttribute('aria-label','Run suite');run.disabled=Boolean(suiteStartBlocker());run.dataset.designFocus='suite/run';const edit=button('Edit suite',()=>updateSuiteDraft({editing:true}),'button');edit.disabled=locked;edit.dataset.designFocus='suite/edit';actions.append(run,edit);section.append(actions);const blocker=suiteStartBlocker();if(blocker)section.append(el('p','feature-caption',blocker));
    }
    section.append(el('p','feature-caption suite-boundary','States are your labels. Each run resets its app fixture; completion does not assess the result.'),suiteStorageNotice());return section;
  }
  function matrixRecipeMatches(actual,expected) {
    const metadata=recipe=>recipe && JSON.stringify({id:recipe.id,title:recipe.title,route:recipe.route,catalogDigest:recipe.catalogDigest,fixture:{id:recipe.fixture?.id,label:recipe.fixture?.label},steps:Array.isArray(recipe.steps)?recipe.steps.map(step=>({id:step.id,title:step.title})):null});
    return Boolean(actual && expected && metadata(actual)===metadata(expected));
  }
  function matrixCellRecipe(record,cell) {return record.basis.suite?record.basis.suite.states.find(row=>row.state===cell.state)?.recipe:record.basis.recipe;}
  function suiteHistory() {
    const records=(matrixSession()?.matrices || []).filter(record=>validMatrix(record) && record.basis.suite && record.basis.feature.id===activeFeature()?.id && record.status!=='running');
    return lazyContentDetails(`State suites · ${records.length}`,`suite-history/${state.project?.id}/${activeFeature()?.id}`,()=>{const list=el('div','matrix-history');if(!records.length)list.append(el('p','feature-caption','No recorded state suites for this feature.'));for(const record of records.slice().reverse())list.append(lazyContentDetails(`${record.basis.suite.title} · ${formatHistoryTime(record.startedAt)}`,`suite/${record.id}/history`,()=>[matrixEvidence(record,`matrix/${record.id}`)],'content-details saved-suite'));return [list];});
  }

  function safeMatrixDraft(value) {
    const id=text=>typeof text==="string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(text),subset=(values,allowed)=>Array.isArray(values)&&values.length<=allowed.length&&new Set(values).size===values.length&&values.every(item=>allowed.includes(item));
    if(!value || value.version!==1 || ![value.projectId,value.featureId,value.screenId,value.scenarioId].every(id) || !(value.recipeId===null || id(value.recipeId)) || !(value.registrationId===null || /^[a-f0-9]{32}$/.test(value.registrationId)) || !(value.catalogDigest===null || /^[a-f0-9]{64}$/.test(value.catalogDigest)) || !subset(value.widths,[390,768,960]) || !subset(value.themes,["light","dark"]) || !subset(value.motions,["system","reduce"]) || typeof value.captureEach!=="boolean")return null;
    return {version:1,projectId:value.projectId,featureId:value.featureId,screenId:value.screenId,scenarioId:value.scenarioId,recipeId:value.recipeId,registrationId:value.registrationId,catalogDigest:value.catalogDigest,widths:[390,768,960].filter(item=>value.widths.includes(item)),themes:["light","dark"].filter(item=>value.themes.includes(item)),motions:["system","reduce"].filter(item=>value.motions.includes(item)),captureEach:value.captureEach};
  }
  function matrixOwner() {
    const feature=activeFeature(),screen=selectedScreen(),scenario=selectedScenario();
    return state.project && feature && screen && scenario ? {projectId:state.project.id,featureId:feature.id,screenId:screen.id,scenarioId:scenario.id}:null;
  }
  function matrixDraft() {
    const owner=matrixOwner();if(!owner)return null;
    return matrixDrafts.get(JSON.stringify(Object.values(owner))) || {...owner,version:1,recipeId:null,registrationId:null,catalogDigest:null,widths:[[390,768,960].includes(Number(state.designWidth))?Number(state.designWidth):960],themes:[state.designTheme==="dark"?"dark":"light"],motions:["system"],captureEach:false};
  }
  function updateMatrixDraft(patch) {
    if(runtimeMatrixBusy())return;const draft=matrixDraft(),next=safeMatrixDraft({...draft,...patch});if(!next)return;
    const key=JSON.stringify([next.projectId,next.featureId,next.screenId,next.scenarioId]);matrixDrafts.delete(key);matrixDrafts.set(key,next);while(matrixDrafts.size>16)matrixDrafts.delete(matrixDrafts.keys().next().value);
    saveView();updateRuntimeView();
  }
  function matrixRequested(draft) {
    return draft?draft.widths.flatMap(viewportWidthCss=>draft.themes.flatMap(theme=>draft.motions.map(motion=>({theme,motion,viewportWidthCss,viewportHeightCss:680})))):[];
  }
  function matrixSession() {
    const value=state.runtimeMatrices;return [1,2].includes(value?.schemaVersion) && value.projectId===state.project?.id && Number.isSafeInteger(value.revision) && value.revision>=0 && Array.isArray(value.matrices) && value.matrices.length<=40?value:null;
  }
  function validMatrix(record) {
    const uuid=value=>typeof value==="string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value),basis=record?.basis;
    return record && uuid(record.id) && /^[a-f0-9]{32}$/.test(record.executionId || "") && ["running","completed","failed","cancelled","interrupted"].includes(record.status) && record.sourceRelationship==="unverified" && typeof record.captureEach==="boolean" && basis?.feature?.id && typeof basis.feature.title==="string" && basis.screen?.id && basis.scenario?.id && basis.recipe?.id && typeof basis.recipe.title==="string" && Array.isArray(basis.sources) && Array.isArray(basis.dirtyPaths) && Array.isArray(record.cells) && record.cells.length>=1 && record.cells.length<=12 && new Set(record.cells.map(cell=>cell?.id)).size===record.cells.length && record.cells.every(cell=>uuid(cell?.id) && uuid(cell.runId) && /^[a-f0-9]{32}$/.test(cell.replayExecutionId || "") && typeof cell.observationLinked==="boolean" && ["not-run","running","completed","failed","cancelled","interrupted"].includes(cell.status) && validMatrixConditions(cell.requested)) && (!basis.suite || (typeof basis.suite.id==="string" && typeof basis.suite.title==="string" && Number.isSafeInteger(basis.suite.revision) && Array.isArray(basis.suite.states) && basis.suite.states.length>=1 && basis.suite.states.length<=5 && new Set(basis.suite.states.map(row=>row.state)).size===basis.suite.states.length && basis.suite.states.every(row=>suiteStates.some(([name])=>name===row.state) && row.recipe?.id && row.recipe?.catalogDigest) && record.cells.every(cell=>basis.suite.states.some(row=>row.state===cell.state)))) && (record.status!=="completed" || record.cells.every(cell=>cell.status==="completed"));
  }
  function validMatrixConditions(value) {return value && [390,768,960].includes(value.viewportWidthCss) && value.viewportHeightCss===680 && ["light","dark"].includes(value.theme) && ["system","reduce"].includes(value.motion);}
  function activeMatrix() {return matrixSession()?.matrices.find(record=>validMatrix(record) && record.status==="running") || null;}
  function runtimeMatrixBusy() {const session=matrixSession();return Boolean(pendingMatrixStart?.projectId===state.project?.id || session?.busy || session?.matrices.some(record=>record?.status==="running"));}
  function matrixPreview() {
    const session=matrixSession(),value=session?.preview,record=activeMatrix();
    return state.trusted && session?.busy===true && record && value?.matrixId===record.id && value.executionId===record.executionId && record.cells.some(cell=>cell.id===value.cellId && ["theme","motion","viewportWidthCss","viewportHeightCss"].every(key=>cell.requested[key]===value.requested?.[key])) && validMatrixConditions(value.requested) && ["prepare","capture"].includes(value.phase) && typeof value.nonce==="string" && /^[a-f0-9-]{32,36}$/.test(value.nonce)?value:null;
  }
  function effectivePreview() {const preview=isRuntimePreview()?matrixPreview():null;return preview?{width:preview.requested.viewportWidthCss,theme:preview.requested.theme,fit:true}:{width:Number(state.designWidth),theme:state.designTheme,fit:state.designFit};}
  function matrixIdentityMatches(identity) {
    const runtime=state.runtime;return identity && runtime?.status==="connected" && runtime.pageConnected && identity.targetId===runtime.target?.id && identity.route===runtime.pagePath && ["session","viewId","documentId","pageVersion"].every(key=>identity[key]===runtime[key]);
  }
  function matrixPreviewCurrent(hint) {
    const preview=matrixPreview();return !assistantSurface && state.mode==="Refine" && isRuntimePreview() && document.visibilityState==="visible" && hint?.projectId===state.project?.id && preview && hint.matrixId===preview.matrixId && hint.executionId===preview.executionId && hint.cellId===preview.cellId && hint.nonce===preview.nonce && hint.phase===preview.phase && ["theme","motion","viewportWidthCss","viewportHeightCss"].every(key=>hint.requested?.[key]===preview.requested[key]) && ["targetId","session","viewId","documentId","route","pageVersion"].every(key=>hint.identity?.[key]===preview.identity?.[key]) && matrixIdentityMatches(preview.identity) && designFrame?.isConnected && !root.querySelector(".design-stage")?.hidden && designFrame.getBoundingClientRect().width>0 && designFrame.getBoundingClientRect().height>0;
  }
  function matrixCanvasBounds() {
    const canvas=designSlot?.querySelector(".design-canvas");if(!canvas || !mainSurface)return null;
    const rect=canvas.getBoundingClientRect(),main=mainSurface.getBoundingClientRect(),bar=root.querySelector(".runtime-studio > .matrix-live-controls")?.getBoundingClientRect();
    return {left:Math.max(rect.left,main.left,0),right:Math.min(rect.right,main.right,innerWidth),top:Math.max(rect.top,main.top,bar?.bottom || 0,0),bottom:Math.min(rect.bottom,main.bottom,innerHeight)};
  }
  function matrixFrameContained() {
    const bounds=matrixCanvasBounds(),rect=designFrame?.getBoundingClientRect();return bounds && rect && rect.width>0 && rect.height>0 && rect.left>=bounds.left && rect.right<=bounds.right && rect.top>=bounds.top && rect.bottom<=bounds.bottom;
  }
  function acknowledgeMatrixPreview() {
    const hint=matrixPreviewHint;if(!matrixPreviewCurrent(hint))return;
    const key=JSON.stringify([hint.projectId,hint.matrixId,hint.executionId,hint.cellId,hint.nonce]);if(matrixPreviewAcknowledgment?.key===key)return;
    const pending={key};matrixPreviewAcknowledgment=pending;designFrame.width=String(hint.requested.viewportWidthCss);sendDesignSettings(true);
    requestAnimationFrame(()=>{
      if(matrixPreviewAcknowledgment!==pending || !matrixPreviewCurrent(hint))return;
      const canvas=designSlot?.querySelector(".design-canvas");if(canvas){canvas.scrollTop=0;canvas.scrollLeft=0;canvas.style.scrollMarginTop=`${root.querySelector(".runtime-studio > .matrix-live-controls")?.getBoundingClientRect().height || 0}px`;canvas.scrollIntoView({block:"start",inline:"nearest",behavior:"instant"});}fitDesignCanvas();
      requestAnimationFrame(()=>{
      if(matrixPreviewAcknowledgment!==pending || !matrixPreviewCurrent(hint) || Number(designFrame.width)!==hint.requested.viewportWidthCss || !matrixFrameContained()){if(matrixPreviewAcknowledgment===pending)matrixPreviewAcknowledgment=null;return;}
      pending.sent=true;vscode.postMessage({type:"runtimeMatrix",action:"previewReady",projectId:hint.projectId,id:hint.matrixId,executionId:hint.executionId,cellId:hint.cellId,nonce:hint.nonce,identity:hint.identity,requested:hint.requested});
      });
    });
  }
  function matrixConditionLabel(requested) {return `${requested.viewportWidthCss} px · ${requested.theme==="dark"?"Dark":"Light"} · ${requested.motion==="reduce"?"Reduced":"Follow system"}`;}
  function matrixReasonText(reason) {return {"host-restarted":"Foundation restarted. Remaining conditions were not run.","host-disposed":"Foundation closed. Remaining conditions were not run.",cancelled:"The matrix was stopped. Recorded evidence is preserved; earlier effects may remain.","capture-failed":"The pixel capture could not be saved. Callback and request evidence remain separate.","observation-failed":"The observation could not be confirmed. Remaining conditions were not run.",capacity:"Local evidence storage has reached its limit. Existing records are preserved.","storage-failed":"Matrix evidence could not be saved. Retry storage; no condition will run again.","preview-changed":"The visible preview changed. Remaining conditions were not run.","recipe-changed":"The app recipe changed. Remaining conditions were not run.","source-changed":"Saved source changed. Remaining conditions were not run.","context-changed":"The selected workspace context changed. Remaining conditions were not run.","runtime-changed":"The runtime changed. Remaining conditions were not run.","transport-failed":"The runtime could not confirm the result.","step-failed":"An app callback failed. Remaining conditions were not run.",timeout:"A condition did not finish in time. Remaining conditions were not run."}[reason] || "The matrix ended without a confirmed result. Remaining conditions were not run.";}
  function matrixStartBlocker() {
    const session=matrixSession(),draft=matrixDraft(),catalog=replayCatalog();
    if(!state.trusted)return "Trust this workspace before running a condition matrix.";
    if(!session)return "Condition matrices are unavailable in this workspace.";
    if(session.storage?.status!=="saved")return session.storage?.message || "Restore matrix storage before starting.";
    if(runtimeMatrixBusy())return "A condition matrix is already active.";
    if(recordingRun())return "Finish the active observation before running a matrix.";
    const unavailable=scenarioBlocker();if(unavailable)return unavailable;
    if(state.mode!=="Refine" || !isRuntimePreview())return "Open the running preview before running a matrix.";
    if(runtimeReplayBusy())return "Finish the active recipe replay before running a matrix.";
    if(state.runtime?.replayBlocked)return replayBlockedText();
    if(state.runtime?.capabilities?.scenarioReplay!==true || !catalog)return "This app has not registered replay recipes.";
    if(!draft?.recipeId)return "Choose an app-authored recipe.";
    if(draft.registrationId!==catalog.registrationId || draft.catalogDigest!==catalog.digest || !catalog.recipes.some(recipe=>recipe.id===draft.recipeId && recipe.route===selectedScreen()?.route))return "The selected recipe changed or is unavailable. Choose a current recipe.";
    const requested=matrixRequested(draft);if(!requested.length || requested.length>12)return "Choose at least one width, app theme and app motion. Up to 12 conditions are supported.";
    if(draft.captureEach && (state.runtimeCaptures?.projectId!==state.project?.id || state.runtimeCaptures?.available!==true))return "Pixel capture is unavailable. Turn off Capture each result to continue without images.";
    return "";
  }
  function runtimeMatrixAction(action,record) {
    if(!state.trusted || !state.project)return;
    const session=matrixSession();
    if(action==="start"){
      if(matrixStartBlocker())return;const draft=matrixDraft(),owner=matrixOwner();pendingMatrixStart={projectId:state.project.id,revision:session.revision};lastMatrixId=null;
      vscode.postMessage({type:"runtimeMatrix",action,...owner,expectedRevision:session.revision,featureRevision:state.features.revision,workspaceRevision:state.runtimeWorkspace.revision,recipeId:draft.recipeId,catalogDigest:draft.catalogDigest,registrationId:draft.registrationId,requested:matrixRequested(draft),captureEach:draft.captureEach});
    }else if(action==="cancel"){
      if(!record || activeMatrix()?.id!==record.id || pendingMatrixCancel===record.executionId || !session?.busy)return;
      pendingMatrixCancel=record.executionId;vscode.postMessage({type:"runtimeMatrix",action,projectId:state.project.id,id:record.id,executionId:record.executionId});
    }else if(action==="retry"){
      if(session?.busy || pendingMatrixStart || !(["error","unavailable"].includes(session?.storage?.status) || matrixRecoveryAvailable()))return;
      vscode.postMessage({type:"runtimeMatrix",action,projectId:state.project.id});
    }else return;
    updateRuntimeView();
  }
  function matrixRecoveryAvailable() {
    return Boolean(matrixSession()?.matrices.some(record=>validMatrix(record) && record.status!=="running" && (record.reason==="storage-failed" || record.cells.some(cell=>cell.reason==="storage-failed"))));
  }
  function matrixStorageNotice() {
    const session=matrixSession(),box=el("div","matrix-storage-notice");
    if(session?.error)box.append(el("p","feature-caption warning",session.error));
    if(["saving","error","unavailable"].includes(session?.storage?.status)){
      const text=el("p","feature-caption warning",session.storage.message || (session.storage.status==="saving"?"Saving matrix evidence…":"Matrix evidence could not be saved."));text.setAttribute("role","status");box.append(text);
      if(session.storage.status!=="saving"){const retry=button("Retry matrix storage",()=>runtimeMatrixAction("retry"),"button small");retry.disabled=Boolean(session.busy || pendingMatrixStart);retry.dataset.designFocus="matrix/retry-storage";box.append(retry);}
    }else if(session?.storage?.status==="saved" && matrixRecoveryAvailable()){
      const recover=button("Recover evidence",()=>runtimeMatrixAction("retry"),"button small");recover.disabled=Boolean(session.busy || pendingMatrixStart);recover.dataset.designFocus="matrix/recover-evidence";box.append(recover,el("p","feature-caption","Reconcile exact saved evidence links after an interrupted write. Application actions are never repeated."));
    }return box;
  }
  function matrixLiveControls() {
    const record=activeMatrix();if(!record && !pendingMatrixStart)return null;
    const box=el("div","matrix-live-controls");box.setAttribute("aria-label","Matrix progress");
    const preview=matrixSession()?.preview,cell=record?.cells.find(item=>item.id===preview?.cellId) || record?.cells.find(item=>item.status==="running"),index=record?.cells.indexOf(cell),copy=el("div");
    const suite=record?.basis.suite,suiteStarting=pendingMatrixStart?.suiteId,cellState=suite?.states.findIndex(row=>row.state===cell?.state),stateCells=suite?record.cells.filter(item=>item.state===cell?.state):null,stateIndex=stateCells?.indexOf(cell);
    if(suite || suiteStarting)box.setAttribute("aria-label","Suite progress");
    const phase=preview?.phase==="capture"?"Capturing result":cell?"Running condition":"Starting matrix";
    if(suite || suiteStarting)copy.append(el("strong","",suite?.title || pendingMatrixStart.title),el("span","feature-caption",cell?`${suiteStateLabel(cell.state)} · State ${cellState+1} of ${suite.states.length} · Condition ${stateIndex+1} of ${stateCells.length} · ${matrixConditionLabel(cell.requested)} · ${phase}`:"Starting suite…"));
    else copy.append(el("strong","",cell?`Condition ${index+1} of ${record.cells.length}`:"Starting matrix…"),el("span","feature-caption",cell?`${matrixConditionLabel(cell.requested)} · ${phase}`:"Preparing the selected conditions."));box.append(copy);
    if(record){const stopping=pendingMatrixCancel===record.executionId,stop=button(stopping?(suite?"Stopping suite…":"Stopping matrix…"):(suite?"Stop suite":"Stop matrix"),()=>runtimeMatrixAction("cancel",record),"button");stop.setAttribute("aria-label",suite?"Stop suite":"Stop matrix");stop.setAttribute("aria-disabled",String(stopping || matrixSession()?.busy!==true));stop.disabled=matrixSession()?.busy!==true;stop.dataset.designFocus="matrix/primary";box.append(stop);}
    return box;
  }
  function matrixObservation(record,cell) {
    if(!cell.observationLinked)return null;
    const run=(state.runtimeWorkspace?.runs || []).find(item=>item.id===cell.runId) || (recordingRun()?.id===cell.runId?recordingRun():null),basis=record.basis;
    if(!run || run.feature?.id!==basis.feature.id || run.feature.revision!==basis.feature.revision || JSON.stringify(run.feature)!==JSON.stringify(basis.feature) || JSON.stringify(run.screen)!==JSON.stringify(basis.screen) || JSON.stringify(run.scenario)!==JSON.stringify(basis.scenario) || JSON.stringify(run.sources)!==JSON.stringify(basis.sources) || JSON.stringify(run.dirtyPaths)!==JSON.stringify(basis.dirtyPaths))return null;
    return run;
  }
  function matrixCellEvidence(record,cell,key) {
    const box=el("div","matrix-cell-evidence"),run=matrixObservation(record,cell),replay=run?savedRunReplay(run):null,capture=run?savedRunCapture(run):null;
    const recipe=matrixCellRecipe(record,cell),matchedReplay=replay?.record && recipe && cell.replayId && replay.record.id===cell.replayId && replay.record.executionId===cell.replayExecutionId && ["theme","motion","viewportWidthCss","viewportHeightCss"].every(key=>replay.record.requested[key]===cell.requested[key]) && matrixRecipeMatches(replay.record.recipe,recipe)?replay.record:null,matchedCapture=capture?.capture && cell.captureId && capture.capture.id===cell.captureId?capture.capture:null;
    const facts=el("dl","request-facts matrix-outcomes");
    const callback=matchedReplay?{running:"Running",completed:"Completed",failed:"Failed",cancelled:"Stopped",interrupted:"Interrupted"}[matchedReplay.status]:cell.status==="not-run"?"Not run":cell.replayId?"Saved replay unavailable":"No confirmed replay result";
    for(const [name,value] of [["App callbacks",callback],["Observed requests",run?`${run.observations.length} · unattributed interval`:cell.observationLinked?"Observation unavailable":"No observation recorded"],["Pixel capture",matchedCapture?"Saved locally":!record.captureEach?"Not requested":cell.captureId?"Saved capture unavailable":"Not captured"],["Manual assessment",run?({matched:"Matched expectation · manual", "not-matched":"Did not match · manual","not-assessed":"Not assessed"}[run.assessment] || "Not assessed"):"Not assessed"]])facts.append(el("dt","",name),el("dd","",value));box.append(facts);
    if(cell.reason)box.append(el("p","feature-caption warning",matrixReasonText(cell.reason)));
    if(cell.observationLinked && !run)box.append(el("p","feature-caption warning","The saved observation does not match this condition. Its evidence is unavailable."));
    if(matchedReplay)box.append(lazyContentDetails("Recipe steps",`${key}/replay`,()=>[replayEvidence(matchedReplay,`${key}/replay`)]));
    if(run){
      if(run.note)box.append(el("p","feature-brief",run.note));
      const freshness=state.runtimeWorkspace?.runFreshness?.find(value=>value.id===run.id);box.append(el("p",freshness?.status==="stale"?"feature-caption warning":"feature-caption",freshness?`${freshness.status==="current"?"Sources match saved snapshot":freshness.status==="stale"?"Saved evidence is stale":"Freshness unknown"}${freshness.reason?` · ${freshness.reason}`:""}`:"Freshness unknown"));
      box.append(lazyContentDetails(`Observed requests · ${run.observations.length}`,`${key}/requests`,()=>{const list=el("div");list.append(el("p","feature-caption","Recorded during this observation interval. A causal relationship to recipe steps is unconfirmed."));for(const item of run.observations)list.append(comparisonRequestDetails(item,`${key}/request/${item.id}`));return [list];}));
      if(run.status!=="recording" && activeFeature()?.id===record.basis.feature.id){const actions=el("div","feature-form-actions");for(const [label,field] of [["Use as baseline","beforeId"],["Use as comparison","afterId"]]){const use=button(label,()=>{const owner=observationComparisonOwner();if(!owner || owner.featureId!==record.basis.feature.id)return;setMode("Understand");disclosureState.set(`feature/${owner.featureId}/runtime`,true);disclosureState.set(`runtime-workspace/${owner.projectId}/${owner.featureId}/comparison`,true);const comparison=root.querySelector(".observation-comparison-details");if(comparison)comparison.open=true;updateObservationComparison(owner,{[field]:run.id});root.querySelector(`[aria-label="${field==="beforeId"?"Baseline":"Comparison"} observation"]`)?.focus({preventScroll:true});},"button small");use.dataset.designFocus=`${key}/${field}`;actions.append(use);}box.append(actions);}
    }
    box.append(lazyContentDetails("Condition provenance",`${key}/provenance`,()=>{const facts=el("dl","request-facts");for(const [name,value] of [...(record.basis.suite?[["Named state",suiteStateLabel(cell.state)],["App recipe",recipe?.title || "Unavailable"],["Fixture",recipe?.fixture?.label || "Unavailable"]]:[]),["Requested condition",matrixConditionLabel(cell.requested)],["Viewport height","680 CSS px"],["Observation",cell.observationLinked?cell.runId:"Not recorded"],["Replay",cell.replayId || "Not recorded"],["Capture",cell.captureId || "Not recorded"],["Saved-source relationship","Unverified"]])facts.append(el("dt","",name),el("dd","",value));return [facts];}));return box;
  }
  function matrixEvidence(record,key) {
    const box=el("div","matrix-evidence");box.dataset.matrixId=record.id;if(record.basis.suite){box.dataset.suiteId=record.basis.suite.id;box.dataset.suiteRevision=String(record.basis.suite.revision);}if(record.id===lastMatrixId && record.status!=="running"){box.dataset.designFocus="matrix/primary";box.tabIndex=-1;}
    const uncertain=record.status==="running" && matrixSession()?.busy!==true,status=uncertain?"Result unconfirmed":{running:"Running",completed:"Recorded",failed:"Failed",cancelled:"Stopped",interrupted:"Interrupted"}[record.status],finished=record.cells.filter(cell=>cell.status!=="not-run" && cell.status!=="running").length;
    const heading=el("div","matrix-evidence-heading");heading.append(el("strong","",record.basis.suite?.title || record.basis.recipe.title),el("span","feature-caption",`${status} · ${finished} of ${record.cells.length} conditions`));box.append(heading,el("p","feature-caption",`${record.basis.screen.title} · ${record.basis.scenario.title}`));
    if(record.basis.suite){box.append(el("p","feature-caption",`Recorded suite revision ${record.basis.suite.revision} · This definition stays with these results.`));const coverage=el("ul","suite-coverage");coverage.setAttribute("aria-label","State coverage");for(const row of record.basis.suite.states){const cells=record.cells.filter(cell=>cell.state===row.state),counts=[['completed','Recorded'],['running','Running'],['failed','Failed'],['cancelled','Stopped'],['interrupted','Interrupted'],['not-run','Not run']].map(([status,label])=>[label,cells.filter(cell=>cell.status===status).length]).filter(([,count])=>count);const item=el("li");item.dataset.suiteState=row.state;item.append(el("strong","",suiteStateLabel(row.state)),el("span","feature-caption",counts.map(([label,count])=>`${count} ${label.toLowerCase()}`).join(" · ")),el("span","feature-caption",`${row.recipe.title} · ${row.recipe.fixture.label}`));coverage.append(item);}box.append(coverage);}
    const list=el("ol","matrix-cells");list.setAttribute("aria-label",record.basis.suite?"Suite conditions":"Matrix conditions");
    for(const cell of record.cells){const row=el("li","matrix-cell");row.dataset.matrixCellId=cell.id;row.dataset.cellStatus=cell.status;if(cell.state)row.dataset.suiteState=cell.state;const head=el("div","matrix-cell-heading");head.append(el("span","",`${record.basis.suite?suiteStateLabel(cell.state)+" · ":""}${matrixConditionLabel(cell.requested)}`),el("span","feature-caption",uncertain && cell.status==="running"?"Unconfirmed":{"not-run":"Not run",running:"Running",completed:"Recorded",failed:"Failed",cancelled:"Stopped",interrupted:"Interrupted"}[cell.status]));row.append(head,lazyContentDetails("Cell evidence",`${key}/${cell.id}`,()=>[matrixCellEvidence(record,cell,`${key}/${cell.id}`)],"content-details matrix-cell-details"));list.append(row);}box.append(list);
    if(record.reason)box.append(el("p",record.reason==="cancelled"?"feature-caption":"feature-caption warning",matrixReasonText(record.reason)));
    box.append(el("p","feature-caption","Callback, request, capture and manual outcomes are separate. No automated visual or behavioral pass is inferred."));return box;
  }
  function conditionMatrixPanel(record) {
    const section=el("section","condition-matrix");section.setAttribute("aria-label",record?.basis.suite?"State suite":"Condition matrix");section.append(el("h3","",record?.basis.suite?"State suite":"Condition matrix"));
    if(record){section.classList.add("inspector-section");section.append(matrixEvidence(record,`matrix/${record.id}`));return section;}
    const draft=matrixDraft();if(!draft)return section;
    section.append(el("p","feature-caption","Run one app-authored recipe across selected conditions. Each condition opens a fresh document and resets its fixture."));
    section.append(lazyContentDetails("Choose conditions",`matrix-setup/${JSON.stringify(matrixOwner())}`,()=>{
      const fields=el("div","matrix-setup"),catalog=replayCatalog(),recipes=(catalog?.recipes || []).filter(recipe=>recipe.route===selectedScreen()?.route),label=el("label","feature-field","App-authored recipe"),select=el("select");select.setAttribute("aria-label","Matrix recipe");select.dataset.designFocus="matrix/recipe";select.disabled=runtimeMatrixBusy() || !recipes.length;
      const none=el("option","","Choose a recipe…");none.value="";select.append(none);for(const recipe of recipes){const option=el("option","",recipe.title);option.value=recipe.id;select.append(option);}
      const missing=draft.recipeId && (draft.registrationId!==catalog?.registrationId || draft.catalogDigest!==catalog?.digest || !recipes.some(recipe=>recipe.id===draft.recipeId));if(missing){const option=el("option","","Selected recipe · unavailable");option.value="unavailable-selection";select.append(option);}select.value=missing?"unavailable-selection":draft.recipeId || "";
      select.addEventListener("change",()=>{if(select.value==="unavailable-selection")return;updateMatrixDraft({recipeId:select.value || null,registrationId:select.value?catalog.registrationId:null,catalogDigest:select.value?catalog.digest:null});});label.append(select);fields.append(label);
      const recipe=missing?null:recipes.find(item=>item.id===draft.recipeId);if(recipe){fields.append(el("p","feature-caption",recipe.fixture.label),lazyContentDetails("Recipe details",`matrix/recipe/${recipe.id}`,()=>{const steps=el("ol","scenario-steps");steps.append(el("li","","Prepare fixture"));for(const step of recipe.steps)steps.append(el("li","",step.title));return [steps,el("p","feature-caption","App-authored actions. Manual scenario instructions are not executed.")];}));}
      for(const [name,title,choices] of [["widths","Width",[[390,"390 px","390 pixel width"],[768,"768 px","768 pixel width"],[960,"960 px","960 pixel width"]]],["themes","App theme",[["light","Light","Light app theme"],["dark","Dark","Dark app theme"]]],["motions","App motion",[["system","Follow system","Follow system app motion"],["reduce","Reduced","Reduced app motion"]]]]){
        const group=el("fieldset","matrix-dimension");group.append(el("legend","",title));const options=el("div","matrix-options");for(const [value,text,accessible] of choices){const choice=el("label","matrix-choice"),input=el("input");input.type="checkbox";input.checked=draft[name].includes(value);input.disabled=runtimeMatrixBusy();input.setAttribute("aria-label",`Include ${accessible}`);input.dataset.designFocus=`matrix/${name}/${value}`;input.addEventListener("change",()=>updateMatrixDraft({[name]:input.checked?[...draft[name],value]:draft[name].filter(item=>item!==value)}));choice.append(input,el("span","",text));options.append(choice);}group.append(options);fields.append(group);
      }
      const capture=el("label","matrix-choice"),checkbox=el("input");checkbox.type="checkbox";checkbox.checked=draft.captureEach;checkbox.disabled=runtimeMatrixBusy();checkbox.setAttribute("aria-label","Capture each result");checkbox.dataset.designFocus="matrix/captures";checkbox.addEventListener("change",()=>updateMatrixDraft({captureEach:checkbox.checked}));capture.append(checkbox,el("span","","Capture each result"));fields.append(capture,el("p","feature-caption","Pixel captures stay on this device and are not shared with AI. App preferences are requested; browser media settings are not emulated."));
      const requested=matrixRequested(draft);fields.append(lazyContentDetails(`${requested.length} selected ${requested.length===1?"condition":"conditions"}`,`matrix/selected/${JSON.stringify(matrixOwner())}`,()=>{const list=el("ol","matrix-selected-conditions");for(const condition of requested)list.append(el("li","",matrixConditionLabel(condition)));return [list];}));
      const blocker=matrixStartBlocker(),start=button(pendingMatrixStart?"Starting matrix…":"Run matrix",()=>runtimeMatrixAction("start"),"button primary");start.setAttribute("aria-label","Run matrix");start.disabled=Boolean(blocker) && !pendingMatrixStart;start.setAttribute("aria-disabled",String(Boolean(blocker)));start.dataset.designFocus="matrix/primary";fields.append(start);if(blocker)fields.append(el("p","feature-caption matrix-guidance",blocker));return [fields];
    },"content-details matrix-setup-details"));
    const last=matrixSession()?.matrices.find(item=>item.id===lastMatrixId && validMatrix(item) && item.basis.feature.id===activeFeature()?.id);if(last)section.append(lazyContentDetails(last.basis.suite?"Last suite":"Last matrix",`matrix/${last.id}/last`,()=>[matrixEvidence(last,`matrix/${last.id}`)],"content-details last-matrix",true));return section;
  }
  function matrixHistory() {
    const records=(matrixSession()?.matrices || []).filter(record=>validMatrix(record) && !record.basis.suite && record.basis.feature.id===activeFeature()?.id && record.status!=="running");
    return lazyContentDetails(`Condition matrices · ${records.length}`,`matrix-history/${state.project?.id}/${activeFeature()?.id}`,()=>{const list=el("div","matrix-history");if(!records.length)list.append(el("p","feature-caption","No saved condition matrices for this feature."));for(const record of records.slice().reverse())list.append(lazyContentDetails(`${record.basis.recipe.title} · ${formatHistoryTime(record.startedAt)}`,`matrix/${record.id}/history`,()=>[matrixEvidence(record,`matrix/${record.id}`)],"content-details saved-matrix"));return [list];});
  }
  function manualScenarioPanel() {
    if(!state.runtimeWorkspace || !activeFeature())return null;
    const matrix=activeMatrix();if(matrix)return conditionMatrixPanel(matrix);
    const run=recordingRun(),scenario=run?.scenario || selectedScenario();if(!scenario)return null;
    const section=el("section","inspector-section manual-scenario");section.append(sectionHeading(run?"Manual observation":"Manual scenario"),el("strong","",scenario.title));
    const steps=el("ol","scenario-steps");for(const step of scenario.steps)steps.append(el("li","",step));
    const content=[steps,el("p","scenario-expected-label","Expected result"),el("p","scenario-expected",scenario.expectedOutcome)];
    section.append(contentDetails("Steps and expected result",`scenario/${scenario.id}/steps`,content,"content-details scenario-instructions",true));
    if(!run){section.append(el("p","feature-caption","Begin an observation to record a manual attempt. Steps are not replayed automatically."),conditionMatrixPanel());const suites=stateSuitePanel();if(suites)section.append(suites);return section;}
    if(!manualRunDrafts.has(run.id))manualRunDrafts.set(run.id,{assessment:"not-assessed",note:""});const draft=manualRunDrafts.get(run.id);
    section.append(el("p","manual-run-status",`Recording since ${formatHistoryTime(run.startedAt)} · ${run.observations.length} ${run.observations.length===1?"request":"requests"}`));
    section.append(scenarioReplayPanel(run));
    const label=el("label","feature-field","Your assessment"),assessment=el("select");assessment.setAttribute("aria-label","Manual observation assessment");assessment.dataset.designFocus="manual-run/assessment";assessment.disabled=runtimeWorkspaceBlocked();
    for(const [value,title] of [["not-assessed","Not assessed"],["matched","Matched expectation · manual"],["not-matched","Did not match · manual"]]){const option=el("option","",title);option.value=value;assessment.append(option);}assessment.value=draft.assessment;assessment.addEventListener("change",()=>{draft.assessment=assessment.value;saveView();});label.append(assessment);
    const noteLabel=el("label","feature-field","Note"),input=el("textarea");input.rows=3;input.maxLength=2000;input.value=draft.note;input.setAttribute("aria-label","Manual observation note");input.dataset.designFocus="manual-run/note";input.disabled=runtimeWorkspaceBlocked();input.addEventListener("input",()=>{draft.note=input.value;saveView();});noteLabel.append(input);
    const actions=el("div","feature-form-actions"),finish=button("Finish observation",()=>runtimeWorkspaceAction("finishRun",{id:run.id,assessment:draft.assessment,note:draft.note}),"button primary");finish.disabled=runtimeWorkspaceBlocked();finish.dataset.designFocus="manual-run/finish";
    const cancel=button("Cancel observation",()=>runtimeWorkspaceAction("cancelRun",{id:run.id}),"button");cancel.disabled=runtimeWorkspaceBlocked();cancel.title="Stop recording and keep captured evidence";cancel.dataset.designFocus="manual-run/cancel";
    const capture=button("Capture and finish observation",()=>runtimeWorkspaceAction("captureAndFinishRun",{id:run.id,assessment:draft.assessment,note:draft.note}),"button");capture.disabled=Boolean(captureRunBlocker());capture.dataset.designFocus="manual-run/capture-finish";capture.setAttribute("aria-busy",String(state.runtimeWorkspace?.busy==="captureAndFinishRun"));
    actions.append(finish,capture,cancel);section.append(label,noteLabel,actions,el("p","feature-caption","Capture saves only the visible preview locally. Images are not shared with AI."));
    const captureReason=captureRunBlocker();if(captureReason){const hint=el("p","feature-caption runtime-capture-guidance",captureReason);hint.setAttribute("role","status");section.append(hint);}
    section.append(el("p","feature-caption","Your assessment is separate from observed requests. No automated check is performed."));return section;
  }
  function scenarioRunHistory() {
    const runs = () => (state.runtimeWorkspace?.runs || []).filter(run => run.feature.id === activeFeature()?.id && run.status !== "recording");
    return lazyContentDetails(`Observation history · ${runs().length}`, `runtime-workspace/${activeFeature()?.id}/history`, () => {
      const list = el("div", "scenario-run-list"), items = runs();
      if (!items.length) list.append(el("p", "feature-caption", "No saved manual observations for this feature."));
      for (const item of items.slice().reverse()) list.append(lazyContentDetails(`${item.scenario.title} · ${item.status === "completed" ? "Recorded" : item.status === "cancelled" ? "Cancelled" : "Interrupted"}`, `run/${item.id}`, () => {
        const run = runs().find(current => current.id === item.id); if (!run) return [];
        const body = el("div", "scenario-run-record"), assessment = {matched:"Matched expectation · manual assessment", "not-matched":"Did not match · manual assessment", "not-assessed":"Not assessed"}[run.assessment] || "Not assessed";
        body.append(el("strong", "", assessment), el("p", "feature-caption", `Recorded ${formatHistoryTime(run.startedAt)} – ${formatHistoryTime(run.endedAt)}`), el("p", "feature-caption", `${run.observations.length} ${run.observations.length === 1 ? "request" : "requests"} recorded during this interval. Their causal relationship to these steps is unconfirmed.`));
        const replay=savedReplayDetails(run,`run/${run.id}`);if(replay)body.append(replay);
        if (run.note) body.append(el("p", "feature-brief", run.note)); if (run.interruption) body.append(note(run.interruption, "warning")); if (run.truncated) body.append(note("Evidence is incomplete. The request capture limit was reached.", "warning"));
        const freshness = state.runtimeWorkspace.runFreshness?.find(value => value.id === run.id);
        body.append(el("p", freshness?.status === "stale" ? "feature-caption warning" : "feature-caption", freshness ? `${freshness.status === "current" ? "Sources match saved snapshot" : freshness.status === "stale" ? "Saved evidence is stale" : "Freshness unknown"}${freshness.reason ? ` · ${freshness.reason}` : ""}` : "Freshness unknown"));
        body.append(lazyContentDetails("Recorded scenario", `run/${run.id}/scenario`, () => {
          const steps = el("ol", "scenario-steps"); for (const step of run.scenario.steps) steps.append(el("li", "", step));
          return [steps, el("p", "scenario-expected", run.scenario.expectedOutcome)];
        }));
        body.append(lazyContentDetails(`Observed requests · ${run.observations.length}`, `run/${run.id}/requests`, () => {
          const requests = el("div"); for (const observation of run.observations) requests.append(observationDetails(observation, `run/${run.id}/${observation.id}`, true)); return [requests];
        }));
        body.append(lazyContentDetails("Recorded provenance", `run/${run.id}/provenance`, () => {
          const evidence = el("div", "run-provenance");
          for (const [label,value] of [["Feature",`${run.feature.title} · revision ${run.feature.revision}`],["Definition revision",run.definitionRevision],["Target",run.runtime.targetId],["Route",run.runtime.route],["Session",run.runtime.session],["View",run.runtime.viewId],["Document",run.runtime.documentId],["Navigation revision",run.runtime.pageVersion ?? "Unavailable"]]) evidence.append(el("span", "feature-caption", label), el("code", "", String(value)));
          for (const source of run.sources) evidence.append(el("span", "feature-caption", source.path), el("code", "", source.revision));
          if (run.dirtyPaths.length) evidence.append(el("p", "feature-caption", `Unsaved drafts excluded: ${run.dirtyPaths.join(", ")}`)); return [evidence];
        }));
        const capture=savedRunCapture(run).capture;if(capture){const show=button("View capture",()=>{issueCaptureSelection={projectId:state.project.id,runId:run.id,captureId:capture.id};reconcileRuntimeCaptureImages();render();},"button small");show.dataset.artifactFocus=`run/${run.id}/capture`;body.append(show);if(issueCaptureSelection?.projectId===state.project?.id&&issueCaptureSelection.runId===run.id&&issueCaptureSelection.captureId===capture.id)body.append(visualCaptureFigure(run,"Observation",`run/${run.id}`));}
        const issue=issueCaptureForm(run);if(issue)body.append(issue);
        return [body];
      }, "content-details saved-scenario-run"));
      return [list];
    });
  }
  function safeObservationComparison(value) {
    const id = text => typeof text === "string" && text.length <= 200 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(text);
    if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1 || !id(value.projectId) || !id(value.featureId) ||
        ![value.beforeId,value.afterId].every(item => item === null || id(item)) ||
        Object.keys(value).some(key => !["version","projectId","featureId","beforeId","afterId"].includes(key))) return null;
    return {version:1,projectId:value.projectId,featureId:value.featureId,beforeId:value.beforeId,afterId:value.afterId};
  }
  function observationComparisonOwner() {
    return state.project && activeFeature() ? {projectId:state.project.id,featureId:activeFeature().id} : null;
  }
  function updateObservationComparison(owner, patch) {
    if (!owner || JSON.stringify(owner) !== JSON.stringify(observationComparisonOwner())) return;
    const key = JSON.stringify([owner.projectId,owner.featureId]);
    const pair = {...(observationComparisons.get(key) || {version:1,...owner,beforeId:null,afterId:null}),...patch};
    if (!safeObservationComparison(pair)) return;
    observationComparisons.delete(key);
    if (pair.beforeId || pair.afterId) observationComparisons.set(key,pair);
    while (observationComparisons.size > 16) observationComparisons.delete(observationComparisons.keys().next().value);
    issueCaptureSelection=null;clearRuntimeCaptureImages();saveView(); render();
  }
  function savedObservationStatus(run) { return {completed:"Recorded",cancelled:"Cancelled",interrupted:"Interrupted"}[run.status] || "Unavailable"; }
  function comparisonRequestDetails(item, key) {
    const details = lazyContentDetails(observationLabel(item),key,() => {
      const facts = el("dl","request-facts");
      for (const [label,value] of [["Outcome",observationOutcome(item)],["Duration",`${item.durationMs} ms`],["Timing",item.timing],["Observed",item.observedAt],["Relationship","Unattributed · no confirmed causal link to the scenario"]]) facts.append(el("dt","",label),el("dd","",value));
      return [facts];
    },"content-details runtime-request");
    details.querySelector("summary").append(el("span",item.outcome === "success" ? "runtime-request-status" : "runtime-request-status warning",observationOutcome(item)));
    return details;
  }
  function savedRunCapture(run) {
    const snapshot=state.runtimeCaptures;
    if(!snapshot)return {reason:"No image was saved with this observation."};
    if(snapshot.schemaVersion!==1 || snapshot.projectId!==state.project?.id || !Array.isArray(snapshot.captures) || snapshot.captures.length>40 || snapshot.captures.some(item=>!item || typeof item!=="object") || new Set(snapshot.captures.map(item=>item.id)).size!==snapshot.captures.length || new Set(snapshot.captures.map(item=>item.runId)).size!==snapshot.captures.length)return {reason:"Saved capture metadata is unavailable."};
    const captures=snapshot.captures.filter(item=>item?.runId===run.id);
    if(!captures.length)return {reason:snapshot.storage?.status==="unavailable" ? "Saved capture metadata is unavailable." : "No image was saved with this observation."};
    if(captures.length!==1)return {reason:"Saved capture metadata is ambiguous."};
    const capture=captures[0],binding=capture.binding,conditions=capture.conditions,image=capture.image;
    const finite=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
    const sameSources=(left,right)=>Array.isArray(left)&&left.length===right.length&&left.every((item,index)=>item?.path===right[index].path&&item.revision===right[index].revision);
    const sameStrings=(left,right)=>Array.isArray(left)&&left.length===right.length&&left.every((item,index)=>item===right[index]);
    const sameRuntime=binding?.runtime&&["targetId","session","viewId","documentId","route","pageVersion"].every(key=>binding.runtime[key]===run.runtime[key]);
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(capture.id||"") || capture.featureId!==run.feature.id || capture.screenId!==run.screen.id || capture.scenarioId!==run.scenario.id || capture.sourceRelationship!=="unverified" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(capture.capturedAt||"") || !Number.isFinite(Date.parse(capture.capturedAt)) || binding?.startedAt!==run.startedAt || binding.definitionRevision!==run.definitionRevision || !sameRuntime || !sameSources(binding.sources,run.sources) || !sameStrings(binding.dirtyPaths,run.dirtyPaths) ||
        !image || image.assetId!==capture.id || image.mimeType!=="image/png" || !/^[a-f0-9]{64}$/.test(image.sha256||"") || !Number.isInteger(image.byteLength) || !finite(image.byteLength,57,16*1024*1024) || !Number.isInteger(image.widthPx) || !Number.isInteger(image.heightPx) || !finite(image.widthPx,1,8192) || !finite(image.heightPx,1,8192) || image.widthPx*image.heightPx>16000000 ||
        !conditions || !finite(conditions.viewportWidthCss,1,16384) || !finite(conditions.viewportHeightCss,1,16384) || !finite(conditions.deviceScaleFactor,.1,8) || !finite(conditions.canvasScale,.1,4) || !finite(conditions.scrollXCss,-10000000,10000000) || !finite(conditions.scrollYCss,-10000000,10000000) || !["light","dark","no-preference","unknown"].includes(conditions.colorSchemePreference) || !["reduce","no-preference","unknown"].includes(conditions.reducedMotionPreference) || [conditions.appTheme,conditions.dataState,conditions.animationState].some(value=>value!=="unknown"))return {reason:"The saved capture does not match this observation or its metadata is unavailable."};
    const cached=runtimeCaptureImages.get(capture.id),asset=cached?.projectId===snapshot.projectId&&cached.sha===capture.image.sha256?cached:null;
    return {capture,cached:asset,imageUri:asset?.status==="ready"?asset.uri:null,loading:!asset||asset.status==="loading",reason:asset?.status==="error"?"The saved image is missing or could not be verified.":"Loading saved image…"};
  }
  function clearRuntimeCaptureImages() {
    for(const entry of runtimeCaptureImages.values())if(entry.uri)URL.revokeObjectURL(entry.uri);
    runtimeCaptureImages.clear();
  }
  function selectedRuntimeCaptureBindings() {
    const owner=observationComparisonOwner();if(!owner || !state.trusted)return [];
    if(issueCaptureSelection?.projectId===state.project.id){const run=state.runtimeWorkspace?.runs.find(value=>value.id===issueCaptureSelection.runId&&value.feature.id===owner.featureId),capture=run&&savedRunCapture(run).capture;if(capture?.id===issueCaptureSelection.captureId)return [capture];}
    const pair=observationComparisons.get(JSON.stringify([owner.projectId,owner.featureId]));if(!pair)return [];
    const compared=workspace.compareObservations(state.runtimeWorkspace,{...owner,...pair});
    return compared.status==="ready"?[savedRunCapture(compared.before.run).capture,savedRunCapture(compared.after.run).capture].filter(Boolean):[];
  }
  function reconcileRuntimeCaptureImages() {
    const selected=selectedRuntimeCaptureBindings();
    for(const [id,entry] of runtimeCaptureImages)if(entry.projectId!==state.project?.id || !selected.some(capture=>capture.id===id&&capture.image.sha256===entry.sha)){
      if(entry.uri)URL.revokeObjectURL(entry.uri);runtimeCaptureImages.delete(id);
    }
  }
  function requestRuntimeCaptureImage(capture) {
    if(!state.trusted || !state.project || state.runtimeCaptures?.projectId!==state.project.id || !selectedRuntimeCaptureBindings().some(value=>value.id===capture.id&&value.image.sha256===capture.image.sha256))return;
    reconcileRuntimeCaptureImages();if(runtimeCaptureImages.has(capture.id))return;
    const entry={projectId:state.project.id,sha:capture.image.sha256,status:"loading",uri:null};runtimeCaptureImages.set(capture.id,entry);
    vscode.postMessage({type:"runtimeCaptureImage",projectId:state.project.id,id:capture.id});
  }
  async function receiveRuntimeCaptureImage(message) {
    const entry=runtimeCaptureImages.get(message.id),capture=selectedRuntimeCaptureBindings().find(value=>value.id===message.id);
    if(!entry || entry.status!=="loading" || entry.decoding || !capture || message.projectId!==state.project?.id || entry.projectId!==message.projectId || entry.sha!==capture.image.sha256)return;
    const current=()=>runtimeCaptureImages.get(message.id)===entry && state.trusted && state.project?.id===entry.projectId && selectedRuntimeCaptureBindings().some(value=>value.id===message.id&&value.image.sha256===entry.sha);
    try {
      if(message.error)throw Error("capture-unavailable");
      if(message.imageSha256!==entry.sha)return;
      entry.decoding=true;
      const encoded=message.pngBase64;if(typeof encoded!=="string" || encoded.length<76 || encoded.length>Math.ceil(16*1024*1024/3)*4 || encoded.length%4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw Error("capture-invalid");
      const decoded=atob(encoded);if(decoded.length!==capture.image.byteLength || btoa(decoded)!==encoded)throw Error("capture-invalid");
      const bytes=Uint8Array.from(decoded,char=>char.charCodeAt(0)),header=new DataView(bytes.buffer);
      if(![137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value) || header.getUint32(12)!==0x49484452 || header.getUint32(16)!==capture.image.widthPx || header.getUint32(20)!==capture.image.heightPx)throw Error("capture-invalid");
      const hash=[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(value=>value.toString(16).padStart(2,"0")).join("");
      if(!current())return;if(hash!==entry.sha)throw Error("capture-invalid");
      entry.uri=URL.createObjectURL(new Blob([bytes],{type:"image/png"}));entry.status="ready";
    } catch {if(!current())return;entry.status="error";}
    if(current())render();
  }
  window.addEventListener("pagehide",clearRuntimeCaptureImages);
  function captureConditionRows(capture) {
    if(!capture)return [];
    const c=capture.conditions, scale=value=>new Intl.NumberFormat(undefined,{maximumFractionDigits:3,useGrouping:false}).format(value);
    return [["Viewport",`${c.viewportWidthCss} × ${c.viewportHeightCss} CSS px`],["Image",`${capture.image.widthPx} × ${capture.image.heightPx} px`],["Device scale",`${scale(c.deviceScaleFactor)}×`],["Canvas scale",`${scale(c.canvasScale)}×`],["Scroll",`${c.scrollXCss}, ${c.scrollYCss} CSS px`],["Color scheme preference",c.colorSchemePreference],["Reduced motion preference",c.reducedMotionPreference],["Application theme","Unknown"],["Application data","Unknown"],["Animation state","Unknown"]];
  }
  function visualCaptureFigure(run,label,key) {
    const view=savedRunCapture(run),figure=el("figure","runtime-capture");figure.setAttribute("aria-label",`${label} visual capture`);figure.dataset.captureStatus=view.imageUri||view.loading?"loading":"unavailable";
    if(view.loading)requestRuntimeCaptureImage(view.capture);
    const caption=el("figcaption","runtime-capture-caption");caption.append(el("strong","",view.capture?"Actual pixel capture":"Visual capture"));figure.append(caption);
    if(view.capture){const time=el("time","feature-caption",`Captured ${formatHistoryTime(view.capture.capturedAt)}`);time.dateTime=view.capture.capturedAt;time.title=view.capture.capturedAt;caption.append(time);}
    const frame=el("div","runtime-capture-frame"),status=el("p","feature-caption runtime-capture-placeholder",view.imageUri?"Loading saved image…":view.reason);status.setAttribute("role","status");frame.append(status);figure.append(frame);
    if(view.imageUri){
      const img=el("img","runtime-capture-image");img.alt=`${label} pixel capture of ${run.screen.title} — ${run.scenario.title}`;img.decoding="async";img.referrerPolicy="no-referrer";img.width=view.capture.image.widthPx;img.height=view.capture.image.heightPx;img.hidden=true;
      const unavailable=()=>{if(runtimeCaptureImages.get(view.capture.id)===view.cached){if(view.cached.uri)URL.revokeObjectURL(view.cached.uri);view.cached.uri=null;view.cached.status="error";}img.remove();figure.dataset.captureStatus="unavailable";status.textContent="The saved image could not be displayed.";status.hidden=false;};
      img.addEventListener("error",unavailable,{once:true});img.addEventListener("load",()=>{if(img.naturalWidth!==view.capture.image.widthPx || img.naturalHeight!==view.capture.image.heightPx){unavailable();return;}status.hidden=true;img.hidden=false;figure.dataset.captureStatus="ready";},{once:true});img.src=view.imageUri;frame.append(img);
    }
    if(view.capture)figure.append(lazyContentDetails("Capture details",`${key}/capture-details`,()=>{const facts=el("dl","request-facts runtime-capture-facts");for(const [name,value] of [["Captured",view.capture.capturedAt],...captureConditionRows(view.capture),["Saved-source relationship","Unverified"]])facts.append(el("dt","",name),el("dd","",value));return [facts];}));
    return figure;
  }
  function visualCaptureConditions(before,after,key) {
    const left=savedRunCapture(before).capture,right=savedRunCapture(after).capture;
    if(!left&&!right)return null;
    const a=new Map(captureConditionRows(left)),b=new Map(captureConditionRows(right));
    return lazyContentDetails("Capture conditions",`${key}/capture-conditions`,()=>{
      const rows=el("div","comparison-evidence-rows");
      for(const label of new Set([...a.keys(),...b.keys()])){const row=el("div","comparison-evidence-row");row.dataset.captureCondition=label;const heading=el("div","comparison-evidence-label",label);if(a.has(label)&&b.has(label)&&a.get(label)!==b.get(label))heading.append(el("span","feature-caption warning","Different"));row.append(heading);
        for(const [name,value] of [["Baseline",a.get(label)],["Comparison",b.get(label)]]){const cell=el("div","comparison-evidence-value");cell.append(el("span","feature-caption",name),el("p","",value||"Not recorded"));row.append(cell);}rows.append(row);}return [rows];
    });
  }
  function comparisonObservation(entry, label, key) {
    const {run,freshness} = entry, column = el("section","comparison-observation"); column.setAttribute("aria-label",`${label} evidence`);
    const heading = el("div","comparison-observation-heading"); heading.append(el("h3","",label),el("span",run.status === "completed" ? "feature-caption" : "feature-caption warning",savedObservationStatus(run)));
    column.append(heading,el("strong","comparison-scenario-title",run.scenario.title),el("p","feature-caption",run.screen.title));
    const time = el("time","feature-caption",`${state.runtimeCaptures?"Finished":"Captured"} ${formatHistoryTime(run.endedAt)}`); time.dateTime=run.endedAt; time.title=run.endedAt; column.append(time);
    if(state.runtimeCaptures)column.append(visualCaptureFigure(run,label,key));
    column.append(el("p","comparison-assessment",{matched:"Matched expectation · manual assessment","not-matched":"Did not match · manual assessment","not-assessed":"Not assessed"}[run.assessment]));
    const replay=savedReplayDetails(run,key);if(replay)column.append(replay);
    if (run.note) column.append(el("p","comparison-note",run.note));
    if (run.interruption) column.append(el("p","feature-caption warning",run.interruption));
    const freshnessBox=el("div","comparison-freshness");freshnessBox.append(el("span",freshness.status === "stale" ? "feature-caption warning" : "feature-caption",{current:"Sources match saved snapshot",stale:"Saved evidence is stale",unknown:"Freshness unknown"}[freshness.status]),el("p","feature-caption",freshness.reason));column.append(freshnessBox);
    const outcomes=new Map();for(const request of run.observations){const outcome=observationOutcome(request);outcomes.set(outcome,(outcomes.get(outcome)||0)+1);}
    const requestSummary=el("div","comparison-request-summary");requestSummary.append(el("strong","",`${run.observations.length} ${run.observations.length === 1 ? "request" : "requests"} recorded`));
    if(outcomes.size)requestSummary.append(el("p","feature-caption",[...outcomes].map(([outcome,count])=>`${count} × ${outcome}`).join(" · ")));column.append(requestSummary);
    column.append(lazyContentDetails("Recorded scenario",`${key}/scenario`,()=>{const steps=el("ol","scenario-steps");for(const step of run.scenario.steps)steps.append(el("li","",step));return [steps,el("p","scenario-expected-label","Expected result"),el("p","scenario-expected",run.scenario.expectedOutcome)];}));
    column.append(lazyContentDetails(`Observed requests · ${run.observations.length}`,`${key}/requests`,()=>{
      const list=el("div","comparison-request-list");list.append(el("p","feature-caption","Saved request metadata. Bodies and headers are excluded. Timings retain their original measurement boundary; no performance change is inferred."));
      for(const request of run.observations)list.append(comparisonRequestDetails(request,`${key}/request/${request.id}`));
      if(!run.observations.length)list.append(el("p","feature-caption","No requests were captured during this interval."));return [list];
    }));
    column.append(lazyContentDetails("Recorded provenance",`${key}/provenance`,()=>{
      const facts=el("div","run-provenance");for(const [name,value] of [["Observation",run.id],["Started",run.startedAt],["Finished",run.endedAt],["Feature",`${run.feature.title} · revision ${run.feature.revision}`],["Definition revision",run.definitionRevision],["Target",run.runtime.targetId],["Route",run.runtime.route],["Session",run.runtime.session],["View",run.runtime.viewId],["Document",run.runtime.documentId],["Navigation revision",run.runtime.pageVersion]])facts.append(el("span","feature-caption",name),el("code","",String(value)));
      if(run.dirtyPaths.length)facts.append(el("p","feature-caption",`Unsaved drafts excluded: ${run.dirtyPaths.join(", ")}`));return [facts];
    }));
    return column;
  }
  function observationComparison() {
    const owner=observationComparisonOwner();if(!owner)return null;
    const key=`runtime-workspace/${owner.projectId}/${owner.featureId}/comparison`;
    return lazyContentDetails("Compare observations",key,()=>{
      const pair=observationComparisons.get(JSON.stringify([owner.projectId,owner.featureId])) || {beforeId:null,afterId:null};
      const choices=workspace.observationChoices(state.runtimeWorkspace,owner), comparison=workspace.compareObservations(state.runtimeWorkspace,{...owner,...pair});
      const body=el("section","observation-comparison");body.setAttribute("aria-label","Observation comparison");body.dataset.comparisonStatus=comparison.status;
      body.append(el("p","feature-caption",state.runtimeReplays?"Saved observations and replay evidence. Comparing does not run the app or assess visual quality.":state.runtimeCaptures?"Saved observations and local pixel captures. No automatic replay or visual pass.":"Saved observations. No automatic replay or visual captures."));
      if(comparison.status!=="ready")body.append(el("p","feature-caption","Choose two observations of the same screen."));
      const controls=el("div","comparison-controls");
      for(const [field,label] of [["beforeId","Baseline"],["afterId","Comparison"]]){
        const fieldLabel=el("label","comparison-choice",label),select=el("select");select.setAttribute("aria-label",`${label} observation`);select.dataset.designFocus=`${key}/${field}`;
        const empty=el("option","","Choose an observation…");empty.value="";select.append(empty);
        for(const run of choices){const option=el("option","",`${run.scenario.title} · ${savedObservationStatus(run)} · ${formatHistoryTime(run.endedAt)} · ${run.id}`);option.value=run.id;select.append(option);}
        if(pair[field] && !choices.some(run=>run.id===pair[field])){const missing=el("option","",`Unavailable observation · ${pair[field]}`);missing.value=pair[field];missing.disabled=true;select.append(missing);}
        select.value=pair[field] || "";select.addEventListener("change",()=>updateObservationComparison(owner,{[field]:select.value || null}));fieldLabel.append(select);controls.append(fieldLabel);
      }
      const actions=el("div","comparison-actions");
      const swap=button("Swap observations",()=>updateObservationComparison(owner,{beforeId:pair.afterId,afterId:pair.beforeId}),"text-button");swap.disabled=!pair.beforeId || !pair.afterId || pair.beforeId===pair.afterId;swap.dataset.designFocus=`${key}/swap`;
      const clear=button("Clear comparison",()=>{updateObservationComparison(owner,{beforeId:null,afterId:null});root.querySelector(`[data-design-focus="${CSS.escape(`${key}/beforeId`)}"]`)?.focus({preventScroll:true});},"text-button");clear.disabled=!pair.beforeId && !pair.afterId;clear.dataset.designFocus=`${key}/clear`;actions.append(swap,clear);controls.append(actions);body.append(controls);
      if(comparison.status!=="ready"){const guidance=el("p",`comparison-guidance feature-caption${comparison.status === "unavailable" ? " warning" : ""}`,comparison.reason);guidance.setAttribute("role","status");body.append(guidance);return [body];}
      const capturedBefore=savedRunCapture(comparison.before.run).capture,capturedAfter=savedRunCapture(comparison.after.run).capture;
      body.append(el("p","feature-caption",capturedBefore||capturedAfter?"Captures stay local and are not shared with AI. Their relationship to saved source is unverified. Application theme, data, and animation state are unknown.":comparison.warnings[0]));
      if(capturedBefore&&capturedAfter&&captureConditionRows(capturedBefore).some(([name,value])=>new Map(captureConditionRows(capturedAfter)).get(name)!==value))body.append(el("p","feature-caption warning","Capture conditions differ. Inspect viewport, scale, scroll, and media preferences before comparing the images."));
      if(state.runtimeCaptures?.storage?.status==="error" || state.runtimeCaptures?.storage?.status==="unavailable")body.append(el("p","feature-caption warning","Capture storage is unavailable. Existing observations remain readable; some images may be missing."));
      const warnings=el("ul","comparison-warnings");warnings.setAttribute("aria-label","Recorded differences and limits");
      // Freshness is shown independently in each evidence column. Keep concrete
      // capture/scope differences visible without repeating those same labels.
      for(const warning of comparison.warnings.slice(2))if(!/^(Baseline|Comparison) evidence (is stale relative to current saved source or definitions|freshness is unknown)\.$/.test(warning))warnings.append(el("li","",warning));
      if(warnings.childElementCount)body.append(warnings);
      const columns=el("div","comparison-columns");columns.append(comparisonObservation(comparison.before,"Baseline",`${key}/${pair.beforeId}/baseline`),comparisonObservation(comparison.after,"Comparison",`${key}/${pair.afterId}/comparison`));body.append(columns);
      const captureConditions=visualCaptureConditions(comparison.before.run,comparison.after.run,key);if(captureConditions)body.append(captureConditions);
      body.append(lazyContentDetails("Comparison limits",`${key}/limits`,()=>[el("p","feature-caption comparison-limit-copy",comparison.warnings[1]),el("p","feature-caption","Baseline and comparison do not imply chronological order. Manual assessments are recorded judgments, not automated verification.")]));
      body.append(lazyContentDetails("Recorded conditions",`${key}/conditions`,()=>{
        const rows=el("div","comparison-evidence-rows");for(const condition of comparison.conditions){const row=el("div","comparison-evidence-row");row.dataset.condition=condition.label;const title=el("div","comparison-evidence-label",condition.label);if(condition.changed)title.append(el("span","feature-caption warning","Different"));row.append(title);
          for(const [name,value] of [["Baseline",condition.before],["Comparison",condition.after]]){const cell=el("div","comparison-evidence-value");cell.append(el("span","feature-caption",name),el("p","",value));row.append(cell);}rows.append(row);}return [rows];
      }));
      body.append(lazyContentDetails(`Source revisions · ${comparison.sources.length}`,`${key}/sources`,()=>{
        const rows=el("div","comparison-evidence-rows comparison-sources");for(const source of comparison.sources){const row=el("div","comparison-evidence-row");row.dataset.sourcePath=source.path;const title=el("div","comparison-evidence-label");title.append(el("code","",source.path),el("span","feature-caption",{same:"Same recorded revision",changed:"Different recorded revisions",added:"Only in comparison",removed:"Only in baseline"}[source.status]));row.append(title);
          for(const [name,value] of [["Baseline",source.beforeRevision],["Comparison",source.afterRevision]]){const cell=el("div","comparison-evidence-value");cell.append(el("span","feature-caption",name),el("code","",value || "Not included"));row.append(cell);}rows.append(row);}return [rows];
      }));
      return [body];
    },"content-details observation-comparison-details");
  }
  function featureRuntimeWorkspace() {
    if(!state.runtimeWorkspace || !activeFeature())return null;
    return lazyContentDetails(`Runtime · ${featureScreens().length} ${featureScreens().length===1?"screen":"screens"}`,`feature/${activeFeature().id}/runtime`,()=>{
    const wrap=el("div","feature-runtime-workspace");
    const tools=el("div","feature-form-actions");
    const screen=button("New screen",()=>editRuntimeDefinition("screen"),"button small","plus"),scenario=button("New scenario",()=>editRuntimeDefinition("scenario"),"button small","plus");screen.disabled=runtimeWorkspaceBlocked(true);scenario.disabled=runtimeWorkspaceBlocked(true)||!selectedScreen();
    const discover=button("Find targets",()=>runtimeAction("discover"),"text-button","refresh");tools.append(screen,scenario,discover);wrap.append(tools);
    const editor=runtimeDefinitionEditor();if(editor)wrap.append(editor);
    wrap.append(runtimeFeatureControls());
    if(!featureScreens().length)wrap.append(el("p","feature-caption","Name a screen and its route to connect this feature to a running target."));
    const manage=el("div","runtime-definition-list");
    for(const screen of featureScreens(true)){
      const row=el("div","runtime-definition-row");row.append(el("span","",`${screen.title}${screen.archived?" · archived":""}`),el("code","",screen.route));
      if(!screen.archived){const edit=button("Edit screen",()=>editRuntimeDefinition("screen",screen.id),"text-button");edit.disabled=runtimeWorkspaceBlocked(true);row.append(edit);}
      const archive=button(screen.archived?"Restore screen":"Archive screen",()=>runtimeWorkspaceAction("archiveScreen",{id:screen.id,archived:!screen.archived}),"text-button");archive.disabled=runtimeWorkspaceBlocked(true);row.append(archive);manage.append(row);
      for(const scenario of state.runtimeWorkspace.scenarios.filter(item=>item.screenId===screen.id)){
        const item=el("div","runtime-definition-row scenario-definition-row");item.append(el("span","",`${scenario.title}${scenario.archived?" · archived":""}`));
        if(!scenario.archived){const edit=button("Edit scenario",()=>editRuntimeDefinition("scenario",scenario.id),"text-button");edit.disabled=runtimeWorkspaceBlocked(true);item.append(edit);}
        const archive=button(scenario.archived?"Restore scenario":"Archive scenario",()=>runtimeWorkspaceAction("archiveScenario",{id:scenario.id,archived:!scenario.archived}),"text-button");archive.disabled=runtimeWorkspaceBlocked(true);item.append(archive);manage.append(item);
      }
    }
    wrap.append(contentDetails("Manage screens and scenarios",`runtime-workspace/${activeFeature().id}/manage`,[manage]),scenarioRunHistory(),matrixHistory(),suiteHistory(),observationComparison());
    return [wrap];
    },"content-details feature-runtime-details");
  }

  function featureTaskCard() {
    const feature=activeFeature();if(!feature)return null;
    const card=el("section","feature-task-card");card.setAttribute("aria-label","Task context");
    const heading=el("div","feature-task-heading");heading.append(el("span","feature-caption","Task context"),el("strong","",feature.title));card.append(heading);
    const includeLabel=el("label","feature-include"),include=el("input");include.type="checkbox";include.checked=state.featureTaskIncluded;include.disabled=state.running;include.setAttribute("aria-label","Include task brief");include.dataset.designFocus="feature/include-task";
    include.addEventListener("change",()=>{state.featureTaskIncluded=include.checked;markAssistantDraftEdited();saveView();renderAssistant();});includeLabel.append(include,el("span","","Include task brief"));card.append(includeLabel);
    card.append(el("p","feature-brief",feature.brief || "No brief added."),el("p","feature-caption","Title and brief only. Choose source files separately."));
    const storage=featureStorageNotice();if(storage)card.append(storage);
    card.append(contentDetails("Edit task brief",`feature/${feature.id}:brief`,[featureEditor(feature.id,true)],"content-details feature-task-edit"));
    if(state.featureTaskIncluded && featureDraftChanged(feature.id))card.append(el("p","feature-draft-warning","Save or discard the feature draft before sending."));
    return card;
  }
  function savedTaskContext(turn) {
    const context=turn.taskContext;if(!context || context.version!==1)return null;
    return contentDetails("Saved task context",`request/${turn.requestId}/task-context`,[
      el("strong","",context.title),el("p","feature-brief",context.brief || "No brief supplied."),
      el("p","feature-caption",`Feature revision ${context.revision} · saved with this request`),
      el("p","artifact-boundary","Historical task context. Current feature edits do not change this request.")
    ],"content-details saved-task-context");
  }

  function understand() {
    if(knowledgeOpenProjectId===state.project?.id)return knowledgePage();
    const file = state.activeFile;
    const wrap = el("div", "understand-page");
    if(window.FoundationKnowledge)wrap.append(understandNavigation());
    if(state.features)wrap.append(featureWorkspace());
    if(!file) {
      const empty=el("section","feature-source-empty");empty.append(el("h2","","Choose source to understand"),el("p","empty-copy","Open a feature file or choose saved source from your project."));
      for(const item of (state.project?.files || []).slice(0,6))empty.append(fileLink(item.path,1,basename(item.path),item.path));
      wrap.append(empty);return wrap;
    }
    const analysis = file.analysis || {
      symbols: [],
      imports: [],
      consumers: [],
      requests: [],
      unsupported: true,
    };
    const primary = choosePrimary(file);
    wrap.append(sourceHeading(file, primary?.name || basename(file.path)));
    const decisions=decisionsForScope("source",file.path);if(decisions)wrap.append(decisions);
    const issues=issuesForScope("source",file.path);if(issues)wrap.append(issues);
    if (activeDirty())
      wrap.append(
        note(
          "Unsaved changes are not included. Save this file to refresh its relationships.",
        ),
      );
    if (analysis.unsupported) {
      wrap.append(note("Source relationships are unavailable for this file type."),
        button("Open in editor", () => navigate(file.path), "button", "code"),
        contentDetails("Inspect the saved source", `source/${file.path}:saved`, [el("pre", "source-code", file.source)], "source-details"));
      return wrap;
    }
    const graph = el("div", "relationship-graph");
    const left = el("section", "relationship-column");
    left.append(sectionHeading("Dependencies", analysis.imports.length || undefined));
    if (!analysis.imports.length)
      left.append(el("p", "empty-copy", "No static imports found."));
    for (const item of analysis.imports.slice(0, 30))
      left.append(
        fileLink(
          item.resolvedPath || file.path,
          item.resolvedPath ? 1 : item.line,
          item.resolvedPath ? basename(item.resolvedPath) : item.specifier,
          item.resolvedPath ? "Local source" : "Package or unresolved",
        ),
      );
    const right = el("section", "relationship-column");
    right.append(sectionHeading("Used by", analysis.consumers.length || undefined));
    if (analysis.consumersTruncated) right.append(el("p", "empty-copy", "Consumer search is incomplete. Refresh or open a smaller project."));
    if (!analysis.consumers.length)
      right.append(
        el(
          "p",
          "empty-copy",
          "No consumers found in the scanned source.",
        ),
      );
    for (const item of analysis.consumers.slice(0, 30))
      right.append(
        fileLink(
          item.path,
          item.line,
          basename(item.path),
          pathParent(item.path),
        ),
      );
    graph.append(left, right);
    const focusedRelationships=featureRelationshipView()?.anchorPath===file.path;
    if(!focusedRelationships)wrap.append(graph);
    const lower = el("div", "understand-lower");
    const symbols = el("section", "surface");
    symbols.append(sectionHeading("Declarations", analysis.symbols.length));
    if (!analysis.symbols.length)
      symbols.append(
        el("p", "empty-copy", "No top-level declarations found."),
      );
    for (const symbol of analysis.symbols.slice(0, 30)) {
      const b = button(
        "",
        () => navigate(file.path, symbol.line),
        "symbol-row",
      );
      b.append(
        el("span", "symbol-kind", symbol.kind),
        el("strong", "", symbol.name),
        el("small", "", symbol.exported ? "exported" : ""),
        el("code", "", symbol.line),
      );
      symbols.append(b);
    }
    const behavior = el("section", "surface behavior");
    behavior.append(
      sectionHeading("Requests in source", analysis.requests.length),
    );
    if (analysis.requests.length)
      for (const request of analysis.requests) {
        const b = button(
          "",
          () => navigate(file.path, request.line),
          "request-row",
        );
        b.append(
          el("span", "method", request.method),
          el("code", "", request.url),
          icon("external", 13),
        );
        behavior.append(b);
      }
    else
      behavior.append(
        el(
          "p",
          "empty-copy",
          "No fetch calls found in this file.",
        ),
      );
    behavior.append(
      el(
        "p",
        "boundary-copy",
        "Source references only. Runtime requests are not captured here.",
      ),
    );
    lower.append(symbols);if(!focusedRelationships)lower.append(behavior);
    wrap.append(lower);
    const code = el("pre", "source-code", file.source);
    wrap.append(contentDetails("Inspect the saved source", `source/${file.path}:saved`, [code], "source-details"));
    return wrap;
  }
  function isRuntimePreview() { return state.previewMode === "runtime" && Boolean(state.runtime); }
  function runtimeURL() {
    try {
      const url = new URL(state.runtime?.url);
      return ["http:", "https:"].includes(url.protocol) && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && !url.username && !url.password ? url : null;
    } catch { return null; }
  }
  function runtimeAction(action, extra = {}) {
    if (!state.trusted || !state.project || runtimeMatrixBusy()) return;
    vscode.postMessage({ type:"runtime", action, ...extra });
  }
  function previewModeControl() {
    const row = el("div", "preview-modebar");
    if (!state.runtime) return row;
    const label = el("label", "preview-mode-label", "Preview source");
    const select = el("select", "preview-mode"); select.setAttribute("aria-label", "Preview source"); select.dataset.designFocus = "preview-mode";select.disabled=runtimeMatrixBusy();
    for (const [value, title] of [["sandbox", "Saved-source sandbox"], ["runtime", "Running project"]]) {
      const option = el("option", "", title); option.value = value; option.selected = state.previewMode === value; select.append(option);
    }
    select.addEventListener("change", () => {
      state.previewMode = select.value; saveView(); render();
      if (state.previewMode === "runtime" && !state.runtime.targets?.length) runtimeAction("discover");
    });
    label.append(select); row.append(label);
    row.append(el("span", "preview-mode-description", isRuntimePreview() ? "Project build and live requests" : "Saved modules · network off"));
    return row;
  }
  function runtimeControls() {
    const controls = el("div", "runtime-controls");
    const busy = ["starting", "connecting"].includes(state.runtime?.status),blocked=busy || runtimeMatrixBusy();
    const connected = state.runtime?.status === "connected";
    const targets = state.runtime?.targets || [];
    if (!targets.some(target => target.id === state.runtimeTargetId)) state.runtimeTargetId = state.runtime?.target?.id || targets[0]?.id || "";
    const targetLabel = el("label", "runtime-target-label", "Target");
    const target = el("select", "runtime-target"); target.setAttribute("aria-label", "Running project target"); target.dataset.designFocus = "runtime-target";
    for (const item of targets) { const option = el("option", "", item.label || item.id); option.value=item.id; option.selected=item.id===state.runtimeTargetId; target.append(option); }
    if (!targets.length) target.append(el("option", "", "No instrumented target found"));
    target.disabled = blocked || connected || !targets.length;
    target.addEventListener("change", () => { state.runtimeTargetId=target.value; updateRuntimeView(); }); targetLabel.append(target);
    const start = button(busy ? state.runtime.status === "starting" ? "Starting…" : "Connecting…" : "Start project", () => runtimeAction("start", {targetId:state.runtimeTargetId}), "button primary runtime-start", "arrow");
    const selectedTarget=targets.find(item=>item.id===state.runtimeTargetId);
    start.disabled = blocked || connected || !state.runtimeTargetId || selectedTarget?.instrumented === false; start.dataset.designFocus = "runtime-start";
    const stop = button(busy ? "Cancel" : state.runtime?.owned ? "Stop project" : "Disconnect", () => runtimeAction("stop"), "button runtime-stop", "stop");
    stop.disabled = runtimeMatrixBusy() || !busy && !["connected", "disconnected", "error"].includes(state.runtime?.status); stop.dataset.designFocus = "runtime-stop";
    stop.title = state.runtime?.owned ? "Stop the process Foundation started" : "Detach without stopping the project";
    const inspectorToggle = button("Inspector", () => { state.inspectorOpen=!state.inspectorOpen; applyStudioLayout(); if(state.inspectorOpen) root.querySelector(".inspector-back")?.focus(); }, "button inspector-toggle", "inspect");
    inspectorToggle.disabled=runtimeMatrixBusy();
    inspectorToggle.setAttribute("aria-controls", "design-inspector"); inspectorToggle.setAttribute("aria-expanded", String(state.inspectorOpen));
    const main = el("div", "runtime-target-row"); main.append(targetLabel, start, stop, inspectorToggle); controls.append(main);
    if(selectedTarget?.instrumented === false) controls.append(el("p","design-guidance",selectedTarget.reason || "Add the Foundation development plugin before starting this target."));
    const urlRow = el("div", "runtime-connect-row");
    const input = el("input", "runtime-url"); input.type="url"; input.placeholder="http://localhost:5173"; input.value=state.runtimeUrlDraft; input.setAttribute("aria-label", "Running project URL"); input.dataset.designFocus="runtime-url"; input.disabled=blocked;
    input.addEventListener("input", () => { state.runtimeUrlDraft=input.value; });
    const connect = button("Connect", () => runtimeAction("connect", {url:state.runtimeUrlDraft.trim()}), "button small"); connect.dataset.designFocus="runtime-connect"; connect.disabled=blocked;
    input.addEventListener("keydown", event => { if(event.key === "Enter" && !blocked) { event.preventDefault(); runtimeAction("connect", {url:input.value.trim()}); } });
    urlRow.append(input, connect);
    controls.append(contentDetails("Connect an existing server", "runtime/connect", [urlRow, el("p", "", "Use a local Vite server with Foundation instrumentation. Connecting does not install or change project files.")], "content-details runtime-connect"));
    if (!targets.length && !connected) controls.append(button("Find targets", () => runtimeAction("discover"), "text-button runtime-discover", "refresh"));
    if(state.runtimeWorkspace && activeFeature())controls.append(runtimeFeatureControls());
    return controls;
  }
  function runtimeStatus() {
    const wrap = el("div", "design-status-region runtime-status");
    const runtime = state.runtime || {};
    if (state.error) wrap.append(note(state.error, "error"));
    if (runtime.error) wrap.append(note(runtime.error, runtime.status === "disconnected" ? "warning" : "error"));
    else if (runtime.status === "disconnected") wrap.append(note("Project disconnected. Reconnect to refresh its measurements and requests.", "warning"));
    if (runtime.selection?.stale) wrap.append(note("Source changed. Select the element again to refresh its mapping.", "warning"));
    if (state.dirtyPaths.length) wrap.append(el("p", "design-guidance", "The running project uses saved source. Unsaved editor changes are excluded."));
    if (runtime.status === "connected") wrap.append(el("p", "runtime-connection-copy", `${runtime.target?.label || "Local project"} · ${runtime.owned ? "Started by Foundation" : "Connected server"}`));
    return wrap;
  }
  function observationLabel(item) { return `${item.method || "GET"} ${item.url || "Request"}`; }
  function observationOutcome(item) {
    return item.outcome === "aborted" ? "Cancelled" : item.outcome === "network-error" ? "Network error" : item.status == null ? "No response" : `${item.status}${item.outcome === "http-error" ? " · Failed" : ""}`;
  }
  function observationDetails(item, key, lazy = false) {
    const facts = () => {
      const dl = el("dl", "request-facts");
      for (const [label,value] of [["Outcome",observationOutcome(item)],["Duration",Number.isFinite(item.durationMs) ? `${Math.round(item.durationMs)} ms` : "Unknown"],["Observed",formatHistoryTime(item.observedAt)],["Relationship", "No confirmed link to the selected element"]]) dl.append(el("dt","",label),el("dd","",value));
      return [dl];
    };
    const details = lazy ? lazyContentDetails(observationLabel(item), key, facts, "content-details runtime-request")
      : contentDetails(observationLabel(item), key, facts(), "content-details runtime-request");
    details.querySelector("summary").append(el("span", item.outcome === "success" ? "runtime-request-status" : "runtime-request-status warning", observationOutcome(item)));
    return details;
  }
  function runtimeRequests() {
    const section = el("section", "inspector-section runtime-requests");
    const requests = state.runtime?.observations || [];
    section.append(sectionHeading("Requests", requests.length));
    if (!requests.length) section.append(el("p", "empty-copy", state.runtime?.status === "connected" ? "Turn Inspect off, then use the app to record its requests." : "Connect a project to observe its requests."));
    else {
      section.append(el("p", "runtime-request-boundary", "Observed in this session. Bodies and sensitive headers are excluded."));
      const list=el("div","runtime-request-list");
      for (const request of requests.slice().reverse()) list.append(observationDetails(request, `runtime/${state.runtime.session}/${state.runtime.viewId || "legacy"}/${request.id}`));
      section.append(list);
      section.append(button("Choose context in Assistant", () => action("foundation.askAI"), "button small", "spark"));
    }
    return section;
  }
  function runtimeEmpty() {
    const empty=el("div","canvas-empty"),status=state.runtime?.status;
    const busy=["starting","connecting"].includes(status);
    const heading=status==="starting"?"Starting project…":status==="connecting"?"Connecting to project…":status==="error"?"Couldn’t connect to this project":status==="disconnected"?"Reconnect your project":"Connect your running app";
    empty.append(icon("inspect",34),el("h2","",heading),el("p","",busy?"Waiting for Foundation instrumentation.":"Start a supported target or connect a local Vite server."),el("span","canvas-boundary","Your project’s build pipeline · real network requests"));
    return empty;
  }
  function runningPreview() {
    const wrap=el("div", "refine-page design-studio runtime-studio");
    renderedPreviewMode="runtime"; renderedDesignSession=state.runtime?.session || null; renderedDesignProject=state.project?.id; renderedRuntimeURL=state.runtime?.url || null; renderedRuntimeViewId=state.runtime?.viewId || null;
    wrap.append(previewModeControl(),runtimeControls(),runtimeStatus());const matrixProgress=matrixLiveControls();if(matrixProgress)wrap.append(matrixProgress);
    const studio=el("div","studio-layout"),stage=el("section","design-stage"); stage.setAttribute("aria-label","Design canvas");
    const toolbar=el("div","canvas-toolbar");
    const size=el("select","canvas-size");size.setAttribute("aria-label","Preview viewport width");
    for (const [value,label] of [["960","Desktop · 960"],["768","Tablet · 768"],["390","Phone · 390"]]) {const option=el("option","",label);option.value=value;option.selected=value===String(effectivePreview().width);size.append(option);}
    size.addEventListener("change",()=>{state.designWidth=size.value;saveView();if(designFrame)designFrame.width=state.designWidth;fitDesignCanvas();});
    const theme=el("select","canvas-theme");theme.setAttribute("aria-label","Preview color theme");
    for(const value of ["light","dark"]){const option=el("option","",value==="light"?"Light":"Dark");option.value=value;option.selected=value===effectivePreview().theme;theme.append(option);}
    theme.addEventListener("change",()=>{state.designTheme=theme.value;saveView();sendDesignSettings();});
    const fit=button("Fit",()=>{state.designFit=!state.designFit;fit.setAttribute("aria-pressed",String(state.designFit));fitDesignCanvas();},"button small canvas-fit");fit.setAttribute("aria-pressed",String(effectivePreview().fit));fit.disabled=runtimeMatrixBusy();fit.setAttribute("aria-label","Fit preview to canvas");fit.title="Scale the preview to fit. The viewport size stays fixed.";
    const inspect=button("Inspect",()=>{state.designInspect=!state.designInspect;inspect.setAttribute("aria-pressed",String(state.designInspect));sendDesignSettings();updateRuntimeView();},"button small inspect-toggle","inspect");inspect.setAttribute("aria-pressed",String(!matrixPreview() && state.designInspect));
    for(const control of [size,theme,inspect])control.disabled=runtimeReplayBusy() || runtimeMatrixBusy();
    toolbar.append(size,theme,fit,inspect);stage.append(toolbar);
    const canvas=el("div","design-canvas");const url=runtimeURL();
    if(url && state.runtime?.session){
      const viewport=el("div","design-viewport");viewport.style.width=`${effectivePreview().width}px`;
      designFrame=el("iframe");designFrame.setAttribute("data-foundation-runtime-canvas","");designFrame.title="Running project preview";designFrame.setAttribute("sandbox","allow-scripts allow-same-origin allow-forms");designFrame.setAttribute("referrerpolicy","no-referrer");designFrame.width=String(effectivePreview().width);designFrame.height="680";designFrame.inert=state.runtime.status!=="connected";
      designFrame.addEventListener("load",()=>{sendDesignSettings(true);fitDesignCanvas();acknowledgeMatrixPreview();});designFrame.src=url.href;viewport.append(designFrame);canvas.append(viewport);
    }else{
      designFrame=null;canvas.append(runtimeEmpty());
    }
    stage.append(canvas);const ruler=el("div","canvas-ruler");ruler.append(el("span","preview-status-label",state.runtime?.status==="connected"?"Project connected":"Project disconnected"),el("span","canvas-ruler-size",`${state.designWidth} px`),el("span","runtime-network-label",state.runtime?.status==="connected"?"Live network":"No live connection"));stage.append(ruler);
    studio.append(stage,resizeSeparator(),designInspector());wrap.append(studio);
    designResizeObserver?.disconnect();designResizeObserver=new ResizeObserver(()=>{if(state.mode==="Refine")fitDesignCanvas();});designResizeObserver.observe(canvas);return wrap;
  }
  function updateRuntimeView() {
    const focus=rememberFocus(),inspector=root.querySelector(".design-inspector"),top=inspector?.scrollTop||0;
    root.querySelector(".runtime-controls")?.replaceWith(runtimeControls());root.querySelector(".design-status-region")?.replaceWith(runtimeStatus());inspector?.replaceWith(designInspector());
    const next=root.querySelector(".design-inspector");if(next)next.scrollTop=top;
    const matrixProgress=matrixLiveControls(),priorProgress=root.querySelector(".runtime-studio > .matrix-live-controls");if(priorProgress){if(matrixProgress)priorProgress.replaceWith(matrixProgress);else priorProgress.remove();}else if(matrixProgress)root.querySelector(".runtime-studio > .studio-layout")?.before(matrixProgress);
    if(designFrame)designFrame.inert=state.runtime?.status!=="connected";
    else root.querySelector(".runtime-studio .canvas-empty")?.replaceWith(runtimeEmpty());
    root.querySelector(".runtime-studio .inspect-toggle")?.setAttribute("aria-pressed",String(!matrixPreview() && state.designInspect));
    for(const control of root.querySelectorAll(".runtime-studio .canvas-size,.runtime-studio .canvas-theme,.runtime-studio .inspect-toggle"))control.disabled=runtimeReplayBusy() || runtimeMatrixBusy();
    const previewMode=root.querySelector(".preview-mode");if(previewMode)previewMode.disabled=runtimeMatrixBusy();
    const effective=effectivePreview(),size=root.querySelector(".runtime-studio .canvas-size"),theme=root.querySelector(".runtime-studio .canvas-theme"),fit=root.querySelector(".runtime-studio .canvas-fit");
    if(designFrame)designFrame.width=String(effective.width);if(size)size.value=String(effective.width);if(theme)theme.value=effective.theme;if(fit){fit.disabled=runtimeMatrixBusy();fit.setAttribute("aria-pressed",String(effective.fit));}
    const status=root.querySelector(".preview-status-label");if(status)status.textContent=state.runtime?.status==="connected"?"Project connected":state.runtime?.status==="starting"?"Starting project":state.runtime?.status==="connecting"?"Connecting":"Project disconnected";
    const network=root.querySelector(".runtime-network-label");if(network)network.textContent=state.runtime?.status==="connected"?"Live network":"No live connection";
    applyStudioLayout();sendDesignSettings();restoreFocus(focus);acknowledgeMatrixPreview();
  }
  function selectedRuntimeEvidence() {
    return (state.runtime?.observations || []).filter(item=>state.runtimeObservationIds.includes(item.id) && item.session===state.runtime?.session);
  }
  function runtimeContextPicker() {
    const section=el("section","runtime-context");const observations=state.runtime?.observations||[];
    section.append(sectionHeading("Runtime observations",state.runtimeObservationIds.length));
    if(state.runtimeObservationIds.length) section.append(button("Clear runtime context",()=>{state.runtimeObservationIds=[];renderAssistant();},"text-button"));
    if(state.runtimeObservationIds.length!==selectedRuntimeEvidence().length)section.append(el("p","context-guidance warning","Some selected observations are no longer available. Clear runtime context or reconnect before sending."));
    if(!observations.length){section.append(el("p","empty-copy","Connect a running project and exercise an interaction to add request evidence."));return section;}
    section.append(el("p","runtime-request-boundary","Only checked observations are shared. Source context is selected separately."));
    for(const item of observations.slice().reverse()){
      const label=el("label","context-choice runtime-context-choice"),input=el("input");input.type="checkbox";input.checked=state.runtimeObservationIds.includes(item.id);input.dataset.artifactFocus=`runtime-context/${item.id}`;input.disabled=state.running||(state.runtime?.status!=="connected"&&!input.checked);
      input.setAttribute("aria-label",`Include ${observationLabel(item)}`);input.addEventListener("change",()=>{state.runtimeObservationIds=input.checked?[...state.runtimeObservationIds.filter(id=>id!==item.id),item.id]:state.runtimeObservationIds.filter(id=>id!==item.id);renderAssistant();});
      const copy=el("span");copy.append(el("strong","",observationLabel(item)),el("small","",`${observationOutcome(item)} · ${Math.round(item.durationMs||0)} ms · Observed`));label.append(input,copy);section.append(label);
    }
    if(state.runtime?.status!=="connected")section.append(el("p","context-guidance warning","Reconnect before sharing observations from this runtime."));
    return section;
  }
  function runtimeEvidenceHistory(turn) {
    if(!Array.isArray(turn.runtimeEvidence)||!turn.runtimeEvidence.length)return null;
    const items=[el("p","artifact-boundary","Saved observations from this request. They do not establish current runtime behavior or a causal link to the selected element.")];
    for(const item of turn.runtimeEvidence){const record=observationDetails(item,`request/${turn.requestId}/runtime/${item.id}`);record.dataset.runtimeEvidence=item.id;items.push(record);}
    return contentDetails(`Saved observations · ${turn.runtimeEvidence.length}`,`request/${turn.requestId}/runtime`,items,"content-details saved-runtime-evidence");
  }

  function designEntries() {
    const entries = state.design?.entries || state.project?.files || [];
    return entries.map((entry) => typeof entry === "string" ? entry : entry.path)
      .filter((path) => /\.(tsx|jsx)$/.test(path));
  }
  function chosenEntry() {
    const entries = designEntries();
    return (entries.includes(state.designEntry) && state.designEntry) ||
      state.design?.entry || entries.find((path) => /(?:^|\/)App\.(tsx|jsx)$/.test(path)) || entries[0] || "";
  }
  function sendDesignSettings(force = false) {
    if (isRuntimePreview()) {
      const url=runtimeURL();
      if (!designFrame?.contentWindow || !state.runtime?.session || !url) return;
      const settings={type:"foundation-runtime-control",session:state.runtime.session,inspect:!matrixPreview() && state.designInspect && state.mode === "Refine",theme:effectivePreview().theme};
      const signature=JSON.stringify(settings);if(!force&&signature===designSettingsSignature)return;designSettingsSignature=signature;
      designFrame.contentWindow.postMessage(settings,url.origin);return;
    }
    if (!designFrame?.contentWindow || !state.design?.session) return;
    const tokens = (state.design.tokens || []).flatMap((token) =>
      Object.hasOwn(state.tokenDrafts, token.id)
        ? [{ name: token.name, value: state.tokenDrafts[token.id], scope: token.scope }]
        : []);
    const settings = { channel: "foundation-design", session: state.design.session,
      type: "settings", theme: state.designTheme, inspect: state.designInspect && state.mode === "Refine", focusPath: state.focus?.origin === "source" ? state.focus.path : undefined, tokens };
    const signature = JSON.stringify(settings);
    if (!force && signature === designSettingsSignature) return;
    designSettingsSignature = signature;
    designFrame.contentWindow.postMessage(settings, "*");
  }
  function fitDesignCanvas() {
    const canvas = designSlot?.querySelector(".design-canvas");
    const viewport = designSlot?.querySelector(".design-viewport");
    if (!canvas || !viewport || !designFrame) return;
    const effective=effectivePreview(),width=effective.width;
    const css = getComputedStyle(canvas);
    const available = canvas.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
    const bounds=matrixPreview()?matrixCanvasBounds():null;
    // The canvas grows with its child. Measuring its current bottom would feed
    // the fitted height back into itself on every ResizeObserver notification.
    const mainBounds=mainSurface?.getBoundingClientRect(),maxHeight=parseFloat(css.maxHeight);
    const outerHeight=bounds?Math.min(mainBounds?.bottom ?? innerHeight,innerHeight)-Math.max(canvas.getBoundingClientRect().top,bounds.top):Infinity;
    const visibleHeight=bounds?Math.max(0,Math.min(Number.isFinite(maxHeight)?maxHeight:Infinity,outerHeight)-parseFloat(css.paddingTop)-parseFloat(css.paddingBottom)-2):Infinity;
    const scale = effective.fit ? Math.min(1, Math.max(0.1, Math.min(available / width,visibleHeight / 680))) : 1;
    if(!bounds)canvas.style.scrollMarginTop="";
    viewport.style.width = `${width * scale}px`;
    viewport.style.height = `${680 * scale}px`;
    designFrame.style.transform = `scale(${scale})`;
    const ruler = root.querySelector(".canvas-ruler-size");
    if (ruler) ruler.textContent = `${width} px${scale < 1 ? ` · ${Math.round(scale * 100)}% view` : ""}`;
  }
  function beginDesign() {
    const entry = chosenEntry();
    if (!entry || state.design?.status === "building") return;
    state.designSelection = null;
    state.tokenDrafts = {};
    state.tokenInputs = {};
    vscode.postMessage({ type: "designStart", entry });
  }
  function designStatus() {
    const wrap = el("div", "design-status-region");
    if (state.error) wrap.append(note(state.error, "error"));
    if (state.design?.error) wrap.append(note(state.design.error, "error"));
    if (state.skippedExperiments) wrap.append(note(`${state.skippedExperiments} token ${state.skippedExperiments === 1 ? "experiment could" : "experiments could"} not be previewed in this selector scope. The source proposal remains available for review.`, "warning"));
    if (state.design?.stale) wrap.append(note("This preview is out of date. Rebuild to use the latest saved source.", "warning"));
    if (state.dirtyPaths.length) wrap.append(el("p", "design-guidance", "Unsaved changes are not included in this preview."));
    const experiments = Object.keys(state.tokenDrafts).length;
    const pendingInputs = Object.entries(state.tokenInputs).some(([id, value]) =>
      value !== (state.design?.tokens || []).find((token) => token.id === id)?.value);
    if (experiments || pendingInputs) {
      const banner = el("div", "experiment-banner");
      banner.append(icon("color", 15), el("span", "", experiments
          ? `${experiments} ${experiments === 1 ? "experiment" : "experiments"} in this canvas. Source is unchanged.`
          : "Unfinished token value. The canvas keeps the last valid value."),
        button("Reset experiments", () => { state.tokenDrafts = {}; state.tokenInputs = {}; sendDesignSettings(); render(); }, "text-button"));
      wrap.append(banner);
    }
    return wrap;
  }
  function measuredValue(styles, name) {
    if (name === "padding" && styles?.paddingTop) {
      const { paddingTop: top, paddingRight: right, paddingBottom: bottom, paddingLeft: left } = styles;
      return top === bottom && right === left ? top === right ? top : `${top} ${right}` : `${top} ${right} ${bottom} ${left}`;
    }
    return styles?.[name] ?? styles?.[name.replace(/-([a-z])/g, (_, char) => char.toUpperCase())] ?? "—";
  }
  function impactTargetKey(target) {
    if (!target) return "";
    return JSON.stringify([target.kind,target.path,String(target.revision || "").slice(0,16),target.kind === "token" ? target.name : null,target.kind === "token" ? target.occurrence : null]);
  }
  function tokenImpactTarget(token) {
    return {kind:"token",path:token.path,revision:token.revision,name:token.name,occurrence:token.occurrence};
  }
  function designImpactView(target) {
    const view=state.designImpact;
    if (!state.trusted || !view || impactTargetKey(view.target || view.result?.target)!==impactTargetKey(target) || view.result && (view.result.projectId!==state.project?.id || impactTargetKey(view.result.target)!==impactTargetKey(target))) return null;
    return view;
  }
  function impactDirtyPaths(view,target) {
    const paths=new Set([target?.path,...(view?.result?.manifest || []).map(file=>file.path)]);
    return [...new Set([...(view?.dirtyPaths || []),...state.dirtyPaths.filter(path=>paths.has(path))])];
  }
  function designImpactReady(target) {
    const view=designImpactView(target);
    return Boolean(view?.status==="ready" && view.id && view.result && !state.dirtyPaths.includes(target.path) && !(view.dirtyPaths || []).includes(target.path) && !(target.kind==="token" && state.design?.stale));
  }
  function inspectDesignImpact(target) {
    state.designImpact={status:"loading",id:null,target,result:null,relatedScenarios:[],message:"Reading saved source…",dirtyPaths:[]};
    vscode.postMessage({type:"designImpact",action:"analyze",target});
    updateDesignView();
  }
  function impactEvidence(result,scenarios,{view=null,frozen=false,stale=false,key="impact"}={}) {
    const body=el("div","design-impact-evidence"),token=result.target.kind==="token";
    body.append(el("strong","design-impact-scope",token?"Shared token declaration":"Component source file"),
      el("p","design-impact-caption",token?"Source references identify uses of this token name. The CSS cascade determines which elements change.":"Direct references to the mapped source file. Editing one rendered instance is not isolated."));
    const source=result.scope.source;
    const location=el("p","design-impact-location",`${source.path}:${source.line} · ${String(source.revision).slice(0,12)}`);
    body.append(location);
    const consumers=Array.isArray(result.consumers)?result.consumers:[],references=Array.isArray(result.tokenReferences)?result.tokenReferences:[],declarations=Array.isArray(result.declarations)?result.declarations:[];
    const canNavigate=!frozen && !stale && view?.status==="ready" && view.id && !state.dirtyPaths.includes(result.target.path);
    const evidenceRow=(item,ref,label)=>{
      const row=el("div","design-impact-row"),copy=el("span","design-impact-row-copy");
      copy.append(el("strong","",label),el("small","",`${ref.path}:${ref.line}`));
      if (canNavigate) {
        const control=button("",()=>vscode.postMessage({type:"designImpact",action:"navigate",id:view.id,evidenceId:item.id,target:"source"}),"design-impact-link");
        control.disabled=[result.target.path,ref.path,item.to?.path].some(path=>state.dirtyPaths.includes(path) || (view?.dirtyPaths || []).includes(path));
        if(control.disabled)control.title="This location uses saved source and has an unsaved draft.";
        control.setAttribute("aria-label",`Open ${label} at ${ref.path}:${ref.line}`);control.dataset.designFocus=`impact/${item.id}/source`;control.append(copy,icon("external",12));row.append(control);
      } else row.append(copy);
      return row;
    };
    if(consumers.length || references.length)body.append(lazyContentDetails(`Source uses · ${consumers.length+references.length}`,`${key}/uses`,()=>{
      const list=el("div","design-impact-list");
      for(const item of consumers.slice(0,80))list.append(evidenceRow(item,item.from,`${({render:"Renders",call:"Calls",import:"Imports",stylesheet:"Uses stylesheet","re-export":"Re-exports","type-reference":"Type reference","test-reference":"Test reference"})[item.kind] || "References"} ${item.to.label || basename(item.to.path)}`));
      for(const item of references.slice(0,80))list.append(evidenceRow(item,item.source,`${item.property} · ${item.scope}`));
      list.append(el("p","design-impact-caption","Saved-source evidence. Runtime reach and test coverage are unverified."));
      if(consumers.length>80 || references.length>80)list.append(el("p","design-impact-caption","Showing the first 80 entries of each kind."));
      return [list];
    },"content-details design-impact-details"));
    else body.append(el("p","design-impact-caption","No supported source uses found. This does not establish that the change is isolated."));
    if(token && declarations.length>1)body.append(lazyContentDetails(`Declarations with this name · ${declarations.length}`,`${key}/declarations`,()=>{
      const list=el("div","design-impact-list");
      for(const item of declarations.slice(0,80))list.append(evidenceRow(item,item.source,`${item.scope}${item.selected?" · Selected declaration":""}`));
      return [list];
    },"content-details design-impact-details"));
    body.append(lazyContentDetails(`Scenarios to check · ${scenarios.length}`,`${key}/scenarios`,()=>{
      const list=el("div","design-impact-list");
      list.append(el("p","design-impact-caption","Linked by feature membership. These scenarios have not been exercised by this analysis."));
      if(!scenarios.length)list.append(el("p","design-impact-caption","No saved scenarios are linked to these source files."));
      for(const item of scenarios.slice(0,80)){
        const row=el("div","design-impact-row"),copy=el("span","design-impact-row-copy");
        copy.append(el("strong","",item.scenarioTitle),el("small","",`${item.featureTitle} · ${item.screenTitle}`));
        if(item.suiteNames?.length)copy.append(el("small","",`Named suites: ${item.suiteNames.join(", ")}`));
        row.append(copy);list.append(row);
      }
      return [list];
    },"content-details design-impact-details"));
    body.append(lazyContentDetails("Analysis details",`${key}/details`,()=>{
      const detail=el("div","design-impact-provenance");
      detail.append(el("p","",`${result.counts?.analyzed ?? 0} files analyzed · ${result.counts?.indexed ?? 0} indexed`),el("p","",`Analyzed ${formatHistoryTime(result.analyzedAt)}`));
      if(result.scope.label)detail.append(el("p","",result.scope.label));
      const limits=el("ul","design-impact-limits");
      for(const limit of (result.limits || []).slice(0,80))limits.append(el("li","",`${limit.path?`${limit.path} · `:""}${limit.detail}`));
      if(limits.childElementCount)detail.append(limits);
      return [detail];
    },"content-details design-impact-details"));
    if(result.truncated)body.append(el("p","design-impact-status","Analysis reached its limit. These results are incomplete."));
    return body;
  }
  function designImpactPanel(target) {
    const section=el("section","design-impact-region"),view=designImpactView(target),dirty=impactDirtyPaths(view,target),targetDirty=dirty.includes(target.path),loading=view?.status==="loading";
    section.setAttribute("aria-label",target.kind==="token"?"Token change impact":"Source change impact");section.setAttribute("aria-busy",String(loading));
    const heading=sectionHeading("Change impact");if(view?.result)heading.append(badge("From source","source"));section.append(heading);
    const status=el("p","design-impact-status");status.setAttribute("role","status");
    status.textContent=targetDirty?"Save the token or mapped source file, then inspect again.":loading?"Reading saved source…":view?.status==="stale"?view.message || "Source or preview changed. Inspect again before preparing a change.":view?.status==="error"?view.message || "Source analysis could not complete. Try again.":view?.message || (!view?"Inspect saved-source scope before preparing a change.":"");
    if(status.textContent)section.append(status);
    if(dirty.length && !targetDirty)section.append(el("p","design-impact-caption","Other files have unsaved changes. This analysis describes their saved source; those drafts remain untouched."));
    if(view?.result)section.append(impactEvidence(view.result,view.relatedScenarios || [],{view,stale:view.status!=="ready" || targetDirty,key:`impact/${view.id || view.result.basisDigest}`}));
    const label=target.kind==="token"?"Inspect change impact":"Inspect source impact",inspect=button(label,()=>{if(!loading)inspectDesignImpact(target);},"button small","inspect");
    inspect.dataset.designFocus=`impact/${target.kind}/inspect`;inspect.setAttribute("aria-disabled",String(loading));inspect.disabled=!state.trusted || !target.revision || targetDirty || target.kind==="token" && Boolean(state.design?.stale);
    section.append(inspect);return section;
  }
  function proposalDesignImpact(proposal) {
    const checkpoint=proposal.designImpact;
    if(checkpoint?.version!==1 || !checkpoint.result || checkpoint.result.projectId!==state.project?.id)return null;
    const section=el("section","proposal-design-impact");section.setAttribute("aria-label","Reviewed change impact");
    const heading=sectionHeading("Change impact");heading.append(badge("From source","source"));section.append(heading,
      el("p","design-impact-caption",proposal.status==="stale"?"Historical preflight. The source basis changed; inspect again before preparing another change.":"Saved with this proposal. This preflight does not verify the implemented result."),
      impactEvidence(checkpoint.result,checkpoint.relatedScenarios || [],{frozen:true,key:`proposal/${proposal.id}/impact`}));
    return section;
  }
  function selectionInspector() {
    const section = el("section", "inspector-section");
    section.append(sectionHeading("Selected element"));
    const selection = isRuntimePreview() ? state.runtime?.selection : state.designSelection === undefined ? state.design?.selection : state.designSelection;
    if (!selection) {
      section.append(el("p", "empty-copy", (isRuntimePreview() ? state.runtime?.status === "connected" : state.design?.status === "ready")
        ? state.unmappedMessage || "Select an element in the canvas to inspect it."
        : isRuntimePreview() ? "Connect a project to inspect layout and styles." : "Start a preview to inspect layout and styles."));
      return section;
    }
    const identity = el("div", "element-identity");
    identity.append(el("code", "", selection.tag || "element"), badge("Observed", "source"));
    section.append(identity, el("p", "element-label", String(selection.label || "Selected element").slice(0, 120)));
    const mapped = Boolean(selection.path) && (!isRuntimePreview() || selection.mapping === "resolved") && !selection.stale;
    if (mapped) section.append(fileLink(selection.path, selection.line || 1, basename(selection.path), "Mapped source"));
    else section.append(el("p", "quiet", selection.stale ? "Source mapping is stale. Select the element again." : selection.mapping === "ambiguous" ? "More than one source location matches. Open source to resolve it before editing." : "Source mapping unavailable for this element."));
    const rect = selection.rect || {};
    const dimensions = el("div", "element-dimensions");
    for (const [label, value] of [["Width", rect.width], ["Height", rect.height]]) {
      const cell = el("div");
      cell.append(el("span", "", label), el("strong", "", Number.isFinite(value) ? `${Math.round(value * 10) / 10} px` : "—"));
      dimensions.append(cell);
    }
    section.append(dimensions);
    const properties = el("dl", "computed-properties");
    for (const [name, label] of [["color", "Text"], ["background-color", "Fill"], ["font-size", "Type size"],
      ["font-weight", "Weight"], ["line-height", "Line height"], ["padding", "Padding"], ["gap", "Gap"], ["border-radius", "Radius"]]) {
      properties.append(el("dt", "", label), el("dd", "", measuredValue(selection.styles, name)));
    }
    section.append(properties);
    if(mapped) {
      const revision=sourceFiles().find(file=>file.path===selection.path)?.revision || selection.revision;
      if(revision)section.append(designImpactPanel({kind:"component",path:selection.path,revision:String(revision).slice(0,16)}));
      else section.append(el("p","design-impact-caption","Open the mapped source to inspect its saved-source impact."));
    }
    if (mapped && (!isRuntimePreview() || state.runtime?.status === "connected")) section.append(button("Ask AI to refine this", () => {
      if (externalAssistant) {
        vscode.postMessage({type:"action", id:"foundation.askAI", projectId:state.project?.id, contextPath:selection.path, intent:"build",
          prompt:`Refine ${selection.label || selection.tag || "this element"} in ${selection.path}. Improve its visual hierarchy and interaction states while preserving its behavior.`});
        return;
      }
      detachRequestRevision();markAssistantDraftEdited();state.contextInitialized=true;
      state.pendingDesignContext = selection.path;
      if (sourceFiles().some((file) => file.path === selection.path)) state.context = [selection.path];
      state.intent = "build";
      state.question = `Refine ${selection.label || selection.tag || "this element"} in ${selection.path}. Improve its visual hierarchy and interaction states while preserving its behavior.`;
      saveView();
      setMode("Assistant");
      if (!sourceFiles().some((file) => file.path === selection.path)) navigate(selection.path, 1);
    }, "button inspector-ai", "spark"));
    return section;
  }
  // Keep this browser-safe subset aligned with server/project/proposals.mjs.
  function validDesignTokenValue(value) {
    if ((typeof value !== "string" || value.length > 120 || value.includes("\0")) || !value.trim() || value !== value.trim()) return false;
    if (/^(?:#[\da-fA-F]{3,4}|#[\da-fA-F]{6}|#[\da-fA-F]{8}|(?:-?\d+(?:\.\d+)?|-?\.\d+)(?:px|rem|em|%|vh|vw|ch|ex|s|ms|deg)?|(?:transparent|currentColor|inherit|initial|unset)|(?:black|white|red|green|blue|gray|grey|yellow|orange|purple|pink|teal|navy|rebeccapurple))$/.test(value)) return true;
    const color = value.match(/^(rgb|rgba|hsl|hsla)\(([^()]*)\)$/);
    if (!color) return false;
    const numeric = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)%?$/;
    let channels, alpha;
    if (color[2].includes(",")) {
      const parts = color[2].split(",").map(part => part.trim());
      if (parts.length !== 3 && parts.length !== 4) return false;
      channels = parts.slice(0, 3);
      alpha = parts[3];
    } else {
      const parts = color[2].split("/");
      if (parts.length > 2) return false;
      channels = parts[0].trim().split(/\s+/);
      alpha = parts[1]?.trim();
    }
    if (channels.length !== 3 || channels.some(part => !numeric.test(part)) || (alpha !== undefined && !numeric.test(alpha))) return false;
    if (color[1].startsWith("hsl") && (!channels[1].endsWith("%") || !channels[2].endsWith("%") || channels[0].endsWith("%"))) return false;
    return true;
  }
  function tokenEditorKey() {
    return JSON.stringify([state.selectedToken, (state.design?.tokens || []).map((token) => [token.id, token.revision, token.value])]);
  }
  function tokenInspector() {
    renderedTokenEditorKey = tokenEditorKey();
    refreshTokenEditor = null;
    const section = el("section", "inspector-section design-token-region");
    const tokens = state.design?.tokens || [];
    section.append(sectionHeading("Design tokens", tokens.length || state.design?.status === "ready" ? tokens.length : undefined));
    if (!tokens.length) {
      section.append(el("p", "empty-copy", state.design?.status === "ready" && state.design?.html ? "No CSS custom properties found in this preview." : "Build a preview to inspect design tokens."));
      return section;
    }
    const filter = el("input", "token-search");
    filter.type = "search";
    filter.placeholder = "Find a token…";
    filter.setAttribute("aria-label", "Find a design token");
    filter.value = state.tokenFilter;
    filter.dataset.designFocus = "filter";
    filter.addEventListener("input", () => {
      state.tokenFilter = filter.value;
      for (const row of section.querySelectorAll(".design-token")) row.hidden = !row.dataset.search.includes(filter.value.toLowerCase());
    });
    section.append(filter);
    const list = el("div", "design-token-list");
    for (const token of tokens.slice(0, 160)) {
      const row = button("", () => { state.selectedToken = token.id; render(); }, state.selectedToken === token.id ? "design-token selected" : "design-token");
      row.dataset.designFocus = `token-${token.id}`;
      row.dataset.search = `${token.name} ${token.scope} ${token.path}`.toLowerCase();
      row.hidden = !row.dataset.search.includes(state.tokenFilter.toLowerCase());
      const value = state.tokenDrafts[token.id] ?? token.value;
      const swatch = el("span", "token-swatch");
      if (/^#[\da-f]{3,8}$/i.test(value)) swatch.style.backgroundColor = value;
      else swatch.append(icon("code", 13));
      const copy = el("span", "token-label");
      copy.append(el("strong", "", token.name), el("small", "", token.scope || "Declared scope"));
      row.append(swatch, copy, el("code", "token-current", value));
      row.setAttribute("aria-pressed", String(state.selectedToken === token.id));
      list.append(row);
    }
    section.append(list);
    const selected = tokens.find((token) => token.id === state.selectedToken);
    if (selected) {
      const editor = el("div", "token-editor");
      editor.append(el("strong", "", selected.name), el("code", "token-scope", selected.scope || "Declared scope"), el("p", "token-scope-note", "Shared declaration · preview changes are temporary"));
      const label = el("label", "token-value-label", "Experiment value");
      const input = el("input", "token-value-input");
      input.type = "text";
      input.maxLength = 120;
      // Keep incomplete typing separate from the last valid canvas experiment.
      // Runtime measurements and host refreshes must never replace the raw draft.
      input.value = state.tokenInputs[selected.id] ?? state.tokenDrafts[selected.id] ?? selected.value;
      input.dataset.designFocus = "value";
      input.setAttribute("aria-label", `Experiment value for ${selected.name}`);
      const feedback = el("p", "token-value-feedback");
      const target=tokenImpactTarget(selected);
      const propose = button("Review token change", () => {
        if(designImpactReady(target))vscode.postMessage({ type: "designPropose", impactId:designImpactView(target).id,path: selected.path,
          revision: selected.revision, name: selected.name, occurrence: selected.occurrence, value: input.value.trim() });
      }, "button primary");
      propose.dataset.designFocus="impact/token/review";
      const validValue = validDesignTokenValue;
      const update = () => {
        state.tokenInputs[selected.id] = input.value;
        const value = input.value.trim();
        const valid = validValue(value);
        const changed = value !== selected.value;
        propose.disabled = !valid || !changed || !designImpactReady(target);
        input.setAttribute("aria-invalid", String(!valid));
        feedback.textContent = !valid ? "Use a color, number, or length. References, rules, and URLs cannot be previewed."
          : state.dirtyPaths.includes(selected.path) ? "Save the token file before reviewing this change."
          : state.design?.stale ? "Rebuild the preview before reviewing this change."
          : changed ? "Experiment only. Source is unchanged." : "Matches the saved source.";
        if (valid) {
          if (changed) state.tokenDrafts[selected.id] = value;
          else delete state.tokenDrafts[selected.id];
          const row = root.querySelector(`[data-design-focus="${CSS.escape(`token-${selected.id}`)}"]`);
          const current = row?.querySelector(".token-current");
          if (current) current.textContent = value;
          const swatch = row?.querySelector(".token-swatch");
          if (swatch && CSS.supports("color", value)) swatch.style.backgroundColor = value;
          sendDesignSettings();
        }
        const status = root.querySelector(".design-status-region");
        status?.replaceWith(designStatus());
      };
      refreshTokenEditor = update;
      input.addEventListener("input", update);
      label.append(input);
      editor.append(label, feedback, designImpactPanel(target), propose, fileLink(selected.path, selected.line, basename(selected.path), `Line ${selected.line}`));
      section.append(editor);
      update();
    }
    return section;
  }
  function designInspector() {
    const aside = el("aside", "design-inspector");
    aside.setAttribute("aria-label", "Design inspector");
    aside.id = "design-inspector";
    aside.addEventListener("keydown", event => { if(event.key === "Escape" && root.querySelector(".studio-layout")?.classList.contains("is-compact")) { event.preventDefault(); state.inspectorOpen = false; root.querySelector(".inspector-toggle")?.focus(); applyStudioLayout(); } });
    const top = el("div", "inspector-title");
    top.append(el("strong", "", "Inspector"), button("Back to canvas", () => { state.inspectorOpen = false; root.querySelector(".inspector-toggle")?.focus(); applyStudioLayout(); }, "text-button inspector-back", "arrow"));
    aside.append(top);
    if(isRuntimePreview()){const manual=manualScenarioPanel();if(manual)aside.append(manual);if(activeMatrix())return aside;}
    aside.append(selectionInspector(), isRuntimePreview() ? runtimeRequests() : tokenInspector());
    return aside;
  }
  function updateDesignView() {
    if (isRuntimePreview()) { updateRuntimeView(); return; }
    const focus = rememberFocus();
    const inspector = root.querySelector(".design-inspector");
    const top = inspector?.scrollTop || 0;
    // Measurement events can arrive after every valid keystroke. Keep the live
    // token editor mounted, including its selection and composition state.
    if (focus.design === "value" && renderedTokenEditorKey === tokenEditorKey()) {
      inspector?.querySelector(".inspector-section")?.replaceWith(selectionInspector());
      const token=(state.design?.tokens || []).find(item=>item.id===state.selectedToken);
      if(token)inspector?.querySelector(".token-editor .design-impact-region")?.replaceWith(designImpactPanel(tokenImpactTarget(token)));
      refreshTokenEditor?.();
    } else inspector?.replaceWith(designInspector());
    const next = root.querySelector(".design-inspector");
    if (next) next.scrollTop = top;
    root.querySelector(".design-status-region")?.replaceWith(designStatus());
    const start = root.querySelector(".design-start");
    if (start) {
      start.disabled = !chosenEntry() || state.design?.status === "building";
      start.textContent = state.design?.status === "building" ? "Building preview…" : state.design?.html ? "Rebuild preview" : "Start preview";
    }
    const status = root.querySelector(".preview-status-label");
    if (status) status.textContent = state.design?.status === "building" ? "Building saved source" : state.design?.observed ? "Preview connected" : state.design?.status === "ready" ? "Waiting for canvas" : "Sandbox preview";
    const source = root.querySelector(".footer-source");
    if (source && state.activeFile) source.textContent = `${basename(state.activeFile.path)} · ${state.activeFile.revision.slice(0, 7)}`;
    applyStudioLayout();
    sendDesignSettings();
    restoreFocus(focus);
  }
  function refine() {
    if (isRuntimePreview()) return runningPreview();
    renderedPreviewMode="sandbox"; renderedRuntimeURL=null; renderedRuntimeViewId=null;
    const wrap = el("div", "refine-page design-studio");
    renderedDesignSession = state.design?.session || null;
    renderedDesignProject = state.project?.id;

    const entrybar = el("div", "design-entrybar");
    const entryLabel = el("label", "design-entry-label", "Preview");
    const select = el("select", "design-entry");
    select.setAttribute("aria-label", "Preview entry component");
    for (const path of designEntries()) {
      const option = el("option", "", path);
      option.value = path;
      option.selected = path === chosenEntry();
      select.append(option);
    }
    if (!select.options.length) select.append(el("option", "", "No React component found"));
    select.disabled = state.design?.status === "building";
    select.addEventListener("change", () => { state.designEntry = select.value; });
    entryLabel.append(select);
    const start = button(state.design?.status === "building" ? "Building preview…" : state.design?.html ? "Rebuild preview" : "Start preview", beginDesign, "button primary design-start", "refresh");
    start.disabled = !chosenEntry() || state.design?.status === "building";
    const inspectorToggle = button("Inspector", () => { state.inspectorOpen = !state.inspectorOpen; applyStudioLayout(); if(state.inspectorOpen) root.querySelector(".inspector-back")?.focus(); }, "button inspector-toggle", "inspect");
    inspectorToggle.setAttribute("aria-controls", "design-inspector");
    inspectorToggle.setAttribute("aria-expanded", String(state.inspectorOpen));
    entrybar.append(entryLabel, start, inspectorToggle);
    wrap.append(previewModeControl(), entrybar, designStatus());
    const studio = el("div", "studio-layout");
    const stage = el("section", "design-stage");
    stage.setAttribute("aria-label", "Design canvas");
    const toolbar = el("div", "canvas-toolbar");
    const size = el("select", "canvas-size");
    size.setAttribute("aria-label", "Preview viewport width");
    for (const [value, label] of [["960", "Desktop · 960"], ["768", "Tablet · 768"], ["390", "Phone · 390"]]) {
      const option = el("option", "", label); option.value = value; option.selected = value === state.designWidth; size.append(option);
    }
    size.addEventListener("change", () => {
      state.designWidth = size.value; saveView();
      const viewport = designSlot?.querySelector(".design-viewport");
      if (viewport) viewport.style.width = `${Number(state.designWidth)}px`;
      if (designFrame) designFrame.width = state.designWidth;
      fitDesignCanvas();
    });
    const theme = el("select", "canvas-theme"); theme.setAttribute("aria-label", "Preview color theme");
    for (const value of ["light", "dark"]) { const option = el("option", "", value === "light" ? "Light" : "Dark"); option.value = value; option.selected = value === state.designTheme; theme.append(option); }
    theme.addEventListener("change", () => { state.designTheme = theme.value; saveView(); sendDesignSettings(); });
    const inspect = button("Inspect", () => {
      state.designInspect = !state.designInspect; inspect.setAttribute("aria-pressed", String(state.designInspect)); sendDesignSettings();
    }, "button small inspect-toggle", "inspect");
    inspect.setAttribute("aria-pressed", String(state.designInspect));
    const fit = button("Fit", () => { state.designFit = !state.designFit; fit.setAttribute("aria-pressed", String(state.designFit)); fitDesignCanvas(); }, "button small canvas-fit");
    fit.setAttribute("aria-pressed", String(state.designFit));
    fit.setAttribute("aria-label", "Fit preview to canvas");
    fit.title = "Scale the preview to fit. Turn off to inspect at 100%; the viewport size stays fixed.";
    toolbar.append(size, theme, fit, inspect);
    stage.append(toolbar);
    const canvas = el("div", "design-canvas");
    if (state.design?.html) {
      // A newly mounted frame has no selected element yet. Measurements from the
      // prior frame must not appear current after switching activities.
      state.designSelection = null;
      state.unmappedMessage = "";
      const viewport = el("div", "design-viewport"); viewport.style.width = `${Number(state.designWidth)}px`;
      designFrame = el("iframe"); designFrame.title = "Live design preview";
      designFrame.setAttribute("sandbox", "allow-scripts allow-forms"); designFrame.setAttribute("referrerpolicy", "no-referrer");
      designFrame.width = state.designWidth; designFrame.height = "680";
      designFrame.addEventListener("load", () => { sendDesignSettings(true); fitDesignCanvas(); });
      designFrame.srcdoc = state.design.html;
      viewport.append(designFrame); canvas.append(viewport);
    } else {
      designFrame = null;
      const empty = el("div", "canvas-empty");
      empty.append(icon("inspect", 34), el("h2", "", state.design?.status === "building" ? "Building preview…" : "No preview yet"),
        el("p", "", "Choose a component above, then start its preview."),
        el("span", "canvas-boundary", "Supports React, local modules, and CSS."));
      canvas.append(empty);
    }
    stage.append(canvas);
    const ruler = el("div", "canvas-ruler");
    ruler.append(el("span", "preview-status-label", state.design?.observed ? "Preview connected" : "Sandbox preview"),
      el("span", "canvas-ruler-size", `${state.designWidth} px`), el("span", "", "Network off"));
    stage.append(ruler);
    studio.append(stage, resizeSeparator(), designInspector()); wrap.append(studio);
    designResizeObserver?.disconnect();
    designResizeObserver = new ResizeObserver(() => { if (state.mode === "Refine") fitDesignCanvas(); });
    designResizeObserver.observe(canvas);
    return wrap;
  }
  function desiredInspectorWidth() { return state.layouts[state.project?.id || "local"]?.inspectorWidth || 320; }
  function applyStudioLayout() {
    const studio = root.querySelector(".studio-layout"); if (!studio || state.mode !== "Refine") return;
    const model = workspace.resolveLayout(studio.clientWidth, inspectorDrag?.width ?? desiredInspectorWidth());
    const inside = studio.querySelector(".design-inspector")?.contains(document.activeElement);
    if (model.compact && inside) state.inspectorOpen = true;
    studio.classList.toggle("is-compact", model.compact);
    studio.style.setProperty("--inspector-width", `${model.width}px`);
    const inspector = studio.querySelector(".design-inspector"), stage = studio.querySelector(".design-stage"), separator = studio.querySelector(".resize-separator");
    const showing = !model.compact || state.inspectorOpen && !runtimeMatrixBusy();
    inspector.hidden = !showing;
    stage.hidden = model.compact && state.inspectorOpen && !runtimeMatrixBusy();
    separator.hidden = model.compact;
    separator.setAttribute("aria-valuenow", String(model.width)); separator.setAttribute("aria-valuemax", String(model.max));
    separator.setAttribute("aria-valuetext", `${model.width} pixels`);
    const toggle = root.querySelector(".inspector-toggle"); if (toggle) { toggle.hidden = !model.compact; toggle.setAttribute("aria-expanded", String(state.inspectorOpen)); }
    if (!stage.hidden) fitDesignCanvas();
  }
  function saveInspectorWidth(width) {
    state.layouts[state.project?.id || "local"] = {inspectorWidth: workspace.snapWidth(width)};
    state.layouts = workspace.normalizeLayouts(state.layouts); saveView();
    if (state.project) vscode.postMessage({ type:"workspaceLayout", projectId:state.project.id, width:workspace.snapWidth(width) });
  }
  function resizeSeparator() {
    const grip = el("div", "resize-separator"); grip.tabIndex = 0; grip.dataset.workspaceFocus = "inspector-resize";
    grip.setAttribute("role", "separator"); grip.setAttribute("aria-label", "Resize inspector");
    grip.setAttribute("aria-orientation", "vertical"); grip.setAttribute("aria-controls", "design-inspector"); grip.setAttribute("aria-valuemin", "280");
    grip.title = "Drag to resize · Arrow keys adjust 4 px · Shift adjusts 32 px · Double-click to reset";
    grip.addEventListener("keydown", event => {
      if (event.key === "Escape" && inspectorDrag) { inspectorDrag = null; applyStudioLayout(); return; }
      const next = workspace.keyboardWidth(Number(grip.getAttribute("aria-valuenow")), event.key, event.shiftKey, Number(grip.getAttribute("aria-valuemax")));
      if(next === null) return; event.preventDefault(); saveInspectorWidth(next); applyStudioLayout();
    });
    grip.addEventListener("dblclick", () => { saveInspectorWidth(320); applyStudioLayout(); });
    grip.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      event.preventDefault(); grip.focus(); grip.setPointerCapture(event.pointerId);
      inspectorDrag = {x:event.clientX, start:Number(grip.getAttribute("aria-valuenow")), width:Number(grip.getAttribute("aria-valuenow"))};
    });
    grip.addEventListener("pointermove", event => {
      if(!inspectorDrag) return;
      inspectorDrag.width = workspace.snapWidth(inspectorDrag.start + inspectorDrag.x - event.clientX, 280, Number(grip.getAttribute("aria-valuemax")));
      applyStudioLayout();
    });
    grip.addEventListener("pointerup", event => { if(inspectorDrag) saveInspectorWidth(inspectorDrag.width); inspectorDrag = null; if(grip.hasPointerCapture(event.pointerId)) grip.releasePointerCapture(event.pointerId); applyStudioLayout(); });
    grip.addEventListener("pointercancel", () => { inspectorDrag = null; applyStudioLayout(); });
    grip.addEventListener("lostpointercapture", () => { inspectorDrag = null; applyStudioLayout(); });
    return grip;
  }
  function safeVisualVerificationDraft(value) {
    const id=value=>typeof value==="string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
    if(!value || value.version!==1 || ![undefined,"change-set"].includes(value.sourceKind) || !id(value.projectId) || !id(value.proposalId) || !/^[a-f0-9]{64}$/.test(value.proposalBasis) || ![value.scenarioId,value.beforeId,value.afterId].every(value=>value===null || id(value)))return null;
    return {version:1,projectId:value.projectId,proposalId:value.proposalId,proposalBasis:value.proposalBasis,scenarioId:value.scenarioId,beforeId:value.beforeId,afterId:value.afterId};
  }
  function visualVerificationDraftKey(value) {return JSON.stringify([value.projectId,value.proposalId,value.proposalBasis]);}
  function visualVerificationView() {
    const view=state.visualVerification;
    return state.trusted && view?.schemaVersion===1 && view.projectId===state.project?.id && Number.isSafeInteger(view.revision) && view.revision>=0 && Array.isArray(view.records) ? view : null;
  }
  function visualVerificationDraft(proposal) {
    const view=visualVerificationView(),basis=view?.proposal;
    if(!basis || basis.proposalId!==proposal?.id || !Array.isArray(basis.scenarios))return null;
    const blank=safeVisualVerificationDraft({version:1,projectId:view.projectId,proposalId:proposal.id,proposalBasis:basis.proposalBasis,scenarioId:null,beforeId:null,afterId:null});
    if(!blank)return null;
    return visualVerificationDrafts.get(visualVerificationDraftKey(blank)) || blank;
  }
  function updateVisualVerificationDraft(proposal,patch) {
    const current=visualVerificationDraft(proposal);if(!current)return;
    const next=safeVisualVerificationDraft({...current,...patch});if(!next)return;
    const key=visualVerificationDraftKey(next);visualVerificationDrafts.delete(key);visualVerificationDrafts.set(key,next);
    while(visualVerificationDrafts.size>16)visualVerificationDrafts.delete(visualVerificationDrafts.keys().next().value);
    visualVerificationConfirmation=null;saveView();render();
  }
  function visualVerificationChoiceReason(draft,scenario) {
    if(!draft?.scenarioId)return "Choose a scenario, then its before and after observations.";
    if(!scenario)return "The selected scenario is unavailable. Choose another scenario.";
    for(const [field,label,choices] of [["beforeId","before",scenario.beforeChoices],["afterId","after",scenario.afterChoices]]) {
      if(!draft[field])return "Choose the "+label+" observation.";
      const choice=choices?.find(value=>value.id===draft[field]);
      if(!choice)return "The selected "+label+" observation is unavailable. Choose another observation.";
      if(choice.eligible!==true)return choice.reason || "The selected "+label+" observation cannot be linked.";
    }
    return draft.beforeId===draft.afterId ? "Choose two different observations." : "";
  }
  function visualVerificationStorageNotice(view,focusKey) {
    if(!view)return null;
    const status=view.storage?.status,failed=["error","unavailable"].includes(status),busy=Boolean(view.busy || pendingVisualVerificationLink || status==="saving");
    if(!failed && !view.error && !busy)return null;
    const box=el("div","visual-verification-feedback");box.setAttribute("role","status");
    box.append(el("p","feature-caption",view.error || (failed ? view.storage.message || "Evidence could not be saved. Your selections and saved history are preserved." : ({compare:"Opening comparison…",viewScenario:"Selecting scenario…",retry:"Restoring evidence storage…"}[view.busy] || "Saving evidence…"))));
    if(failed){const retry=button("Retry evidence storage",()=>{const latest=visualVerificationView();if(!latest || latest.busy || pendingVisualVerificationLink || alternativeOperationBusy())return;vscode.postMessage({type:"visualVerification",action:"retry",projectId:latest.projectId,expectedRevision:latest.revision});},"button small");retry.disabled=Boolean(view.busy || pendingVisualVerificationLink || alternativeOperationBusy());retry.dataset.artifactFocus=focusKey+"/retry";box.append(retry);}
    return box;
  }
  function visualVerificationPanel(proposal) {
    if(proposal.origin!=="design")return null;
    const box=el("section","visual-verification-panel");box.setAttribute("aria-label","Visual change verification");
    box.append(sectionHeading("Verification"));
    const view=visualVerificationView(),draft=visualVerificationDraft(proposal),basis=view?.proposal,applied=proposal.status==="applied";
    const key="visual-verification/"+proposal.id,busy=Boolean(view?.busy || pendingVisualVerificationLink || view?.storage?.status==="saving" || alternativeOperationBusy());box.setAttribute("aria-busy",String(busy));
    if(!applied)box.append(el("p","feature-caption","Before applying, record a baseline observation and capture in the scenario. After applying, record the result and link both observations here."));
    if(!draft){if(applied)box.append(el("p","feature-caption",view ? "Verification is unavailable for this proposal." : "Loading verification evidence…"));return box;}
    const notice=visualVerificationStorageNotice(view,key);if(notice)box.append(notice);
    const scenario=basis.scenarios.find(value=>value.scenarioId===draft.scenarioId);
    const scenarioLabel=el("label","feature-field","Scenario"),select=el("select");select.setAttribute("aria-label","Scenario");select.dataset.artifactFocus=key+"/scenario";
    const none=el("option","","Choose a scenario…");none.value="";select.append(none);
    for(const value of basis.scenarios){const option=el("option","",value.scenarioTitle+" · "+value.screenTitle);option.value=value.scenarioId;select.append(option);}
    if(draft.scenarioId && !scenario){const missing=el("option","","Selected scenario · unavailable");missing.value=draft.scenarioId;missing.disabled=true;select.append(missing);}
    select.value=draft.scenarioId || "";select.disabled=alternativeOperationBusy() || !basis.scenarios.length;select.addEventListener("change",()=>updateVisualVerificationDraft(proposal,{scenarioId:select.value || null,beforeId:null,afterId:null}));scenarioLabel.append(select);box.append(scenarioLabel);
    if(!basis.scenarios.length)box.append(el("p","feature-caption","No scenarios are linked to this change. Add a screen and scenario to its feature in Understand."));
    if(applied){
      const pair=el("div","visual-verification-choices");
      for(const [field,label,choices] of [["beforeId","Before observation",scenario?.beforeChoices],["afterId","After observation",scenario?.afterChoices]]){
        const fieldLabel=el("label","feature-field",label),control=el("select");control.setAttribute("aria-label",label);control.dataset.artifactFocus=key+"/"+field;
        const empty=el("option","","Choose "+(field==="beforeId"?"before":"after")+"…");empty.value="";control.append(empty);
        for(const choice of choices || []){const label=choice.endedAt ? formatHistoryTime(choice.endedAt)+" · "+({completed:"Completed recording",cancelled:"Stopped recording",interrupted:"Interrupted",recording:"Recording"}[choice.status] || "Observation") : choice.label;const option=el("option","",label+(choice.eligible===true ? "" : " · "+(choice.reason || "Unavailable")));option.value=choice.id;option.disabled=choice.eligible!==true;control.append(option);}
        if(draft[field] && !(choices || []).some(choice=>choice.id===draft[field])){const missing=el("option","","Selected observation · unavailable");missing.value=draft[field];missing.disabled=true;control.append(missing);}
        control.value=draft[field] || "";control.disabled=alternativeOperationBusy() || !scenario;control.addEventListener("change",()=>updateVisualVerificationDraft(proposal,{[field]:control.value || null}));fieldLabel.append(control);
        if(scenario && !choices?.length)fieldLabel.append(el("span","feature-caption",field==="beforeId"?"No observation matches the baseline source.":"No observation matches the applied source."));
        pair.append(fieldLabel);
      }
      box.append(pair);
    }
    const controls=el("div","feature-form-actions");
    if(applied){
      const blocked=view.storage?.status!=="saved" ? "Restore evidence storage before linking." : basis.canLink!==true ? basis.reason || "This proposal cannot be linked to observations." : visualVerificationChoiceReason(draft,scenario);
      const link=button(pendingVisualVerificationLink || view.busy==="link" || view.storage?.status==="saving" ? "Linking evidence…" : "Link evidence",()=>{
        const latest=visualVerificationView(),current=visualVerificationDraft(proposal),selected=latest?.proposal?.scenarios?.find(value=>value.scenarioId===current?.scenarioId);
        if(!latest || latest.busy || pendingVisualVerificationLink || alternativeOperationBusy() || latest.storage?.status!=="saved" || latest.proposal?.canLink!==true || !current || visualVerificationChoiceReason(current,selected))return;
        pendingVisualVerificationLink={...current,expectedRevision:latest.revision,existingIds:latest.records.map(value=>value.id)};visualVerificationConfirmation=null;
        vscode.postMessage({type:"visualVerification",action:"link",projectId:latest.projectId,expectedRevision:latest.revision,proposalBasis:current.proposalBasis,scenarioId:current.scenarioId,beforeId:current.beforeId,afterId:current.afterId});render();
      },"button primary");link.disabled=alternativeOperationBusy() || Boolean(blocked) && !busy;link.setAttribute("aria-disabled",String(busy || link.disabled));link.dataset.artifactFocus=key+"/link";link.setAttribute("aria-label","Link evidence");controls.append(link);
      const feedback=el("p","feature-caption",visualVerificationConfirmation?.key===visualVerificationDraftKey(draft) && visualVerificationConfirmation.beforeId===draft.beforeId && visualVerificationConfirmation.afterId===draft.afterId ? "Evidence linked. Review the recorded outcomes below." : blocked || "Links the saved source revisions to these observations. It does not establish a visual pass.");feedback.setAttribute("role","status");box.append(feedback);
    }
    const viewScenario=button("View scenario",()=>{
      const latest=visualVerificationView(),current=visualVerificationDraft(proposal),selected=latest?.proposal?.scenarios?.find(value=>value.scenarioId===current?.scenarioId);
      if(!latest || latest.busy || alternativeOperationBusy() || !current || selected?.canView!==true)return;
      pendingVisualVerificationNavigation={action:"viewScenario",projectId:latest.projectId,featureId:selected.featureId,screenId:selected.screenId,scenarioId:selected.scenarioId};
      vscode.postMessage({type:"visualVerification",action:"viewScenario",projectId:latest.projectId,expectedRevision:latest.revision,proposalBasis:current.proposalBasis,featureId:selected.featureId,screenId:selected.screenId,scenarioId:selected.scenarioId});
    },"button");viewScenario.disabled=busy || scenario?.canView!==true;viewScenario.title=scenario?.reason || "Select this scenario in Refine. Opening the screen and recording are separate actions.";viewScenario.dataset.artifactFocus=key+"/view-scenario";controls.append(viewScenario);box.append(controls);
    if(scenario?.canView!==true && scenario?.reason)box.append(el("p","feature-caption",scenario.reason));
    return box;
  }
  function visualVerificationFacts(label,side) {
    const section=el("section","visual-verification-side");section.setAttribute("aria-label",label+" linked evidence");section.append(el("h3","",label));
    if(!side){section.append(el("p","feature-caption","The linked observation is unavailable. The saved association is retained."));return section;}
    const facts=el("dl","visual-verification-facts");
    const rows=[
      ["Observation",{completed:"Completed recording",cancelled:"Stopped recording",interrupted:"Interrupted",recording:"Recording"}[side.status] || "Unavailable"],
      ["Your assessment",{matched:"Matched expectation · manual","not-matched":"Did not match · manual","not-assessed":"Not assessed"}[side.assessment] || "Not assessed"],
      ["Recipe callbacks",side.replay ? ({completed:"Completed app callbacks",failed:"Failed",cancelled:"Stopped",interrupted:"Interrupted",running:"Running"}[side.replay.status] || "Unavailable") : "Not recorded"],
      ["Capture",side.capture ? "Recorded · load image in comparison" : "No available capture"],
      ["Recorded",formatHistoryTime(side.endedAt || side.startedAt)]
    ];
    for(const [name,value] of rows)facts.append(el("dt","",name),el("dd","",value));section.append(facts);
    if(side.note)section.append(el("p","feature-caption",side.note));return section;
  }
  function visualVerificationHistory() {
    const view=visualVerificationView();if(!view || !view.records.length && !["error","unavailable"].includes(view.storage?.status))return null;
    const section=el("section","surface visual-verification-history");section.setAttribute("aria-label","Linked verification history");section.append(sectionHeading("Linked evidence",view.records.length));
    if(state.proposal?.origin!=="design"){const notice=visualVerificationStorageNotice(view,"visual-verification/history");if(notice)section.append(notice);}
    for(const record of view.records){
      const key="visual-verification/"+view.projectId+"/record/"+record.id;
      if(pendingVisualVerificationReveal===key){disclosureState.set(key,true);pendingVisualVerificationReveal=null;}
      section.append(lazyContentDetails(record.scenarioTitle+" · "+record.title,key,()=>{
        const body=el("div","visual-verification-record");body.dataset.verificationRecord=record.id;
        body.append(el("p","feature-caption",record.path+" · Linked "+formatHistoryTime(record.createdAt)));
        const facts=el("dl","visual-verification-facts");
        for(const [name,value] of [["Source association","Baseline → applied revision"],["Current source",{"applied-current":"Matches applied source","source-changed":"Changed since this proposal",historical:"Historical proposal",unknown:"Relevance unknown"}[record.currentRelevance] || "Relevance unknown"],["Compilation","Not recorded"],["Visual assessment","Not assessed"],["Source to pixels","Unverified"]])facts.append(el("dt","",name),el("dd","",value));body.append(facts);
        const pair=el("div","visual-verification-sides");pair.append(visualVerificationFacts("Before",record.before),visualVerificationFacts("After",record.after));body.append(pair);
        if(record.reason)body.append(el("p","feature-caption warning",record.reason));
        for(const warning of record.warnings || [])body.append(el("p","feature-caption warning",warning));
        const compare=button("Compare observations",()=>{
          const latest=visualVerificationView(),entry=latest?.records.find(value=>value.id===record.id);if(!latest || latest.busy || alternativeOperationBusy() || entry?.canCompare!==true)return;
          pendingVisualVerificationNavigation={action:"compare",projectId:latest.projectId,id:entry.id,featureId:entry.featureId,beforeId:entry.beforeId,afterId:entry.afterId};
          vscode.postMessage({type:"visualVerification",action:"compare",projectId:latest.projectId,expectedRevision:latest.revision,id:entry.id});
        },"button small");compare.disabled=Boolean(view.busy) || alternativeOperationBusy() || record.canCompare!==true;compare.dataset.artifactFocus=key+"/compare";body.append(compare);return [body];
      },"content-details visual-verification-record-details"));
    }
    return section;
  }
  function acknowledgeVisualVerificationNavigation() {
    const pending=pendingVisualVerificationNavigation;if(!pending?.ack || assistantSurface || !state.trusted || pending.projectId!==state.project?.id || pending.featureId!==activeFeature()?.id)return false;
    if(pending.action==="compare"){
      const record=visualVerificationView()?.records.find(value=>value.id===pending.id);
      if(record?.canCompare!==true || ["featureId","beforeId","afterId"].some(key=>record[key]!==pending[key])){pendingVisualVerificationNavigation=null;return false;}
      pendingVisualVerificationNavigation=null;knowledgeOpenProjectId=null;state.mode="Understand";
      const revealKeys=["feature/"+pending.featureId+"/runtime","runtime-workspace/"+pending.projectId+"/"+pending.featureId+"/comparison"];
      for(const key of revealKeys)disclosureState.set(key,true);
      // Host navigation can mount collapsed details before this acknowledgment.
      // Keep the mounted state in sync before render snapshots those disclosures.
      for(const details of root.querySelectorAll("details[data-lazy-disclosure]"))
        if(details.dataset.disclosureOwner===lazyDisclosureOwner() && revealKeys.includes(details.dataset.lazyDisclosure))details.open=true;
      updateObservationComparison({projectId:pending.projectId,featureId:pending.featureId},{beforeId:pending.beforeId,afterId:pending.afterId});
      root.querySelector('[aria-label="Observation comparison"]')?.scrollIntoView({block:"start",behavior:"instant"});
      root.querySelector('[aria-label="Baseline observation"]')?.focus({preventScroll:true});return true;
    }
    if(pending.screenId!==state.runtimeWorkspace?.activeScreenId || pending.scenarioId!==state.runtimeWorkspace?.activeScenarioId)return false;
    pendingVisualVerificationNavigation=null;state.mode="Refine";state.previewMode="runtime";saveView();render();return true;
  }
  function reconcileVisualVerification() {
    const view=visualVerificationView(),pending=pendingVisualVerificationLink;
    if(pending){
      if(!view || pending.projectId!==view.projectId || view.error || ["error","unavailable"].includes(view.storage?.status))pendingVisualVerificationLink=null;
      else if(view.revision>pending.expectedRevision && view.storage?.status==="saved"){
        const saved=view.records.find(record=>!pending.existingIds.includes(record.id) && record.proposalId===pending.proposalId && record.scenarioId===pending.scenarioId && record.beforeId===pending.beforeId && record.afterId===pending.afterId);
        if(saved){visualVerificationConfirmation={key:visualVerificationDraftKey(pending),beforeId:pending.beforeId,afterId:pending.afterId};pendingVisualVerificationReveal="visual-verification/"+view.projectId+"/record/"+saved.id;}
        pendingVisualVerificationLink=null;
      }
    }
    if(pendingVisualVerificationNavigation && (!view || view.error || pendingVisualVerificationNavigation.projectId!==state.project?.id))pendingVisualVerificationNavigation=null;
  }
  // Alternatives have their own storage, runtime and image ownership. They never
  // replace the original preview or treat app callbacks as visual acceptance.
  function alternativeView() {
    const value=state.visualAlternatives;
    return state.trusted && value?.schemaVersion===1 && value.projectId===state.project?.id && Number.isInteger(value.revision) && Array.isArray(value.records) ? value : null;
  }
  function alternativeOperationBusy() {return Boolean(alternativeView()?.busy || alternativeView()?.operation || pendingAlternativeAction && pendingAlternativeAction.projectId===state.project?.id);}
  function safeAlternativeDraft(value) {
    const id=value=>typeof value==="string" && value.length>0 && value.length<=200 && !/[\u0000-\u001f]/.test(value);
    if(!value || value.version!==1 || ![undefined,"change-set"].includes(value.sourceKind) || !id(value.projectId) || !id(value.proposalId) || !/^[a-f0-9]{64}$/.test(value.proposalBasis || "") || !validMatrixConditions(value.requested) || ![null,undefined].includes(value.scenarioId) && !id(value.scenarioId) || ![null,undefined].includes(value.recipeId) && !id(value.recipeId))return null;
    return {version:1,projectId:value.projectId,proposalId:value.proposalId,proposalBasis:value.proposalBasis,...value.sourceKind==="change-set"?{sourceKind:"change-set"}:{},scenarioId:value.scenarioId || null,recipeId:value.recipeId || null,requested:{theme:value.requested.theme,motion:value.requested.motion,viewportWidthCss:value.requested.viewportWidthCss,viewportHeightCss:680},captureEach:value.captureEach===true,...typeof value.candidateName==="string" && value.candidateName.length<=80 && !/[\u0000-\u001f]/.test(value.candidateName)?{candidateName:value.candidateName}:{}};
  }
  function alternativeDraftKey(value) {return JSON.stringify([value.projectId,value.sourceKind || "token",value.proposalId,value.proposalBasis]);}
  function alternativePreparation(view,kind) {return kind==="change-set"?view?.groupProposal:view?.proposal;}
  function groupAlternative(record) {return record?.source?.kind==="change-set";}
  function alternativeDraft(kind) {
    const view=alternativeView(),proposal=alternativePreparation(view,kind),owner=kind==="change-set"?state.changeSetSession?.current:state.proposal;
    if(!proposal || proposal.id!==owner?.id)return null;
    const blank=safeAlternativeDraft({version:1,projectId:view.projectId,proposalId:proposal.id,proposalBasis:proposal.proposalBasis,...kind==="change-set"?{sourceKind:kind}:{},scenarioId:null,recipeId:null,candidateName:String(owner?.title || "Alternative").replace(/[\u0000-\u001f]/g," ").slice(0,80),requested:{theme:"light",motion:"system",viewportWidthCss:960,viewportHeightCss:680},captureEach:false});
    if(!blank)return null;const saved=alternativeDrafts.get(alternativeDraftKey(blank));return saved?{...blank,...saved,candidateName:saved.candidateName ?? blank.candidateName}:blank;
  }
  function updateAlternativeDraft(patch,renderNow=true,kind) {
    const current=alternativeDraft(kind);if(!current)return;const next=safeAlternativeDraft({...current,...patch});if(!next)return;
    const key=alternativeDraftKey(next);alternativeDrafts.delete(key);alternativeDrafts.set(key,next);while(alternativeDrafts.size>16)alternativeDrafts.delete(alternativeDrafts.keys().next().value);saveView();if(renderNow)render();
  }
  function alternativeBlocker(view,draft) {
    if(!view || !draft)return "Loading comparison setup…";
    if(!draft.candidateName?.trim())return "Name this alternative before preparing.";
    if(view.storage?.status!=="saved")return view.storage?.message || "Restore comparison storage before preparing.";
    const source=alternativePreparation(view,draft.sourceKind);
    if(source?.canPrepare!==true)return source?.reason || "This proposal is not available for comparison.";
    if(draft.captureEach && view.captureAvailable===false)return view.captureUnavailableReason || "Pixel capture is unavailable. Turn off captures to continue.";
    if(!draft.scenarioId)return source.scenarios?.length ? "Choose a scenario and its app recipe." : "No scenarios are linked to this source. Add a screen and scenario to its feature first.";
    const scenario=source.scenarios?.find(value=>value.scenarioId===draft.scenarioId);
    if(!scenario)return "The selected scenario is unavailable. Choose another scenario.";
    if(scenario.canChoose!==true)return scenario.reason || "This scenario is unavailable.";
    if(!scenario.recipes?.length)return scenario.reason || "Connect the instrumented app and register a recipe for this screen.";
    if(!draft.recipeId)return "Choose an app recipe.";
    if(!scenario.recipes.some(value=>value.id===draft.recipeId))return "The selected recipe is unavailable. Choose another recipe.";
    return "";
  }
  function alternativeAction(action,record) {
    const view=alternativeView();if(!view || (action==="stop" ? !view.busy && view.operation?.action!=="review" && pendingAlternativeAction?.action!=="review" || pendingAlternativeAction?.action==="stop" : pendingAlternativeAction || view.busy || view.operation))return;
    if(action==="run" && (view.storage?.status!=="saved" || view.records.find(value=>value.id===record?.id)?.status!=="ready"))return;
    const message={type:"visualAlternatives",action,projectId:view.projectId,...action!=="stop"?{expectedRevision:view.revision}:{},...record?{id:record.id}:{}};
    pendingAlternativeAction={...message};vscode.postMessage(message);render();
  }
  function alternativeStorageNotice(view) {
    if(!view || !view.error && !["error","unavailable"].includes(view.storage?.status))return null;
    const box=el("div","alternative-feedback");box.setAttribute("role","status");box.append(el("p","feature-caption",view.error || view.storage.message || "Comparison storage is unavailable. Saved history is preserved."));
    if(["error","unavailable"].includes(view.storage?.status)){const retry=button("Retry comparison storage",()=>alternativeAction("retry"),"button small");retry.disabled=Boolean(view.busy || pendingAlternativeAction);retry.dataset.artifactFocus="alternatives/retry";box.append(retry);}
    return box;
  }
  function alternativeSelect(label,value,options,onChange,key,disabled) {
    const field=el("label","feature-field",label),select=el("select");select.setAttribute("aria-label",label);select.dataset.artifactFocus=key;select.disabled=disabled;
    if(value && !options.some(option=>option[0]===String(value)))options=[...options,[String(value),"Unavailable selection"]];
    for(const [id,title] of options){const option=el("option","",title);option.value=id;option.selected=id===String(value || "");select.append(option);}
    select.addEventListener("change",()=>onChange(select.value));field.append(select);return field;
  }
  function alternativePanel(proposal,kind) {
    if(assistantSurface || proposal.status!=="proposed" || (kind==="change-set"?proposal.origin!=="ai":proposal.origin!=="design"))return null;
    const view=alternativeView(),draft=alternativeDraft(kind),source=alternativePreparation(view,kind),box=el("section","alternative-panel");box.setAttribute("aria-label","Compare before applying");box.dataset.alternativeSourceKind=kind || "token";box.dataset.alternativeSourceId=proposal.id;box.append(sectionHeading("Compare before applying"),el("p","feature-caption",kind==="change-set"?`Run saved source and all ${proposal.files.length} staged files in separate local copies, with the same scenario and conditions. Your source and unsaved drafts stay in place.`:"Run saved source and the proposed change in separate local copies, with the same scenario and conditions. Your source and unsaved drafts stay in place."));
    const busy=Boolean(view?.busy || view?.operation || pendingAlternativeAction || view?.storage?.status==="saving");box.setAttribute("aria-busy",String(busy));
    const notice=alternativeStorageNotice(view);if(notice)box.append(notice);
    if(!draft){box.append(el("p","feature-caption",view ? source?.reason || "Comparison is unavailable for this proposal." : "Loading comparison setup…"));return box;}
    if(kind==="change-set"){box.append(el("p","feature-caption",`Entire group · ${proposal.files.length} files`),alternativeFileList(proposal.files,"Included files",`alternatives/group/${proposal.id}/included`));}
    const key="alternatives/"+(kind==="change-set"?"group/":"")+proposal.id,scenario=source.scenarios?.find(value=>value.scenarioId===draft.scenarioId),choices=el("div","alternative-choices");
    const nameLabel=el("label","feature-field","Alternative name"),nameInput=el("input");nameInput.type="text";nameInput.maxLength=80;nameInput.value=draft.candidateName;nameInput.disabled=busy;nameInput.setAttribute("aria-label","Alternative name");nameInput.dataset.designFocus=key+"/name";nameLabel.append(nameInput);box.append(nameLabel);
    choices.append(alternativeSelect("Comparison scenario",draft.scenarioId,[["","Choose scenario"],...(source.scenarios || []).map(value=>[value.scenarioId,value.screenTitle+" · "+value.title])],value=>updateAlternativeDraft({scenarioId:value || null,recipeId:null},true,kind),key+"/scenario",busy),alternativeSelect("Comparison recipe",draft.recipeId,[["","Choose recipe"],...(scenario?.recipes || []).map(value=>[value.id,value.title])],value=>updateAlternativeDraft({recipeId:value || null},true,kind),key+"/recipe",busy || !scenario));
    box.append(choices);const conditions=el("div","alternative-conditions");
    for(const [label,field,options] of [["Comparison width","viewportWidthCss",[["960","Desktop · 960 px"],["768","Tablet · 768 px"],["390","Phone · 390 px"]]],["Comparison theme","theme",[["light","Light"],["dark","Dark"]]],["Comparison motion","motion",[["system","Follow system"],["reduce","Request reduced motion"]]]])conditions.append(alternativeSelect(label,draft.requested[field],options,value=>updateAlternativeDraft({requested:{...draft.requested,[field]:field==="viewportWidthCss"?Number(value):value}},true,kind),key+"/"+field,busy));
    box.append(conditions);
    const capture=el("label","matrix-choice"),input=el("input");input.type="checkbox";input.checked=draft.captureEach;input.disabled=busy || view.captureAvailable===false && !draft.captureEach;input.dataset.artifactFocus=key+"/capture";input.addEventListener("change",()=>updateAlternativeDraft({captureEach:input.checked},true,kind));capture.append(input,el("span","","Save a pixel capture of each result"));box.append(capture);if(view.captureAvailable===false)box.append(el("p","feature-caption",view.captureUnavailableReason || "Pixel capture is unavailable in this host. Recipe and request evidence can still be recorded."));
    const blocker=alternativeBlocker(view,draft),prepare=button(pendingAlternativeAction?.action==="prepare"?"Preparing comparison…":"Prepare comparison",()=>{
      const latest=alternativeView(),current=alternativeDraft(kind);if(!latest || !current || latest.busy || pendingAlternativeAction || alternativeBlocker(latest,current))return;
      const message={type:"visualAlternatives",action:"prepare",projectId:latest.projectId,expectedRevision:latest.revision,proposalId:current.proposalId,proposalBasis:current.proposalBasis,...kind==="change-set"?{sourceKind:kind}:{},candidateName:current.candidateName.trim(),scenarioId:current.scenarioId,recipeId:current.recipeId,requested:{...current.requested},captureEach:current.captureEach};
      pendingAlternativeAction={...message,existingIds:latest.records.map(value=>value.id)};vscode.postMessage(message);render();
    },"button");prepare.disabled=!busy && Boolean(blocker);prepare.setAttribute("aria-disabled",String(busy || Boolean(blocker)));prepare.dataset.artifactFocus=key+"/prepare";box.append(prepare);
    const feedback=el("p","feature-caption",blocker || "Preparation freezes the comparison. Run it when you are ready.");feedback.setAttribute("role","status");box.append(feedback);
    nameInput.addEventListener("input",()=>{updateAlternativeDraft({candidateName:nameInput.value},false,kind);const reason=alternativeBlocker(alternativeView(),alternativeDraft(kind));nameInput.setAttribute("aria-invalid",String(!nameInput.value.trim()));prepare.disabled=!busy && Boolean(reason);prepare.setAttribute("aria-disabled",String(busy || Boolean(reason)));feedback.textContent=reason || "Preparation freezes the comparison. Run it when you are ready.";});return box;
  }
  function alternativeFileList(files,label,key) {
    const list=el("ul","alternative-files");for(const file of files){const row=el("li");row.append(el("code","",typeof file==="string"?file:file.path));if(file.beforeHash && file.afterHash)row.append(el("span","feature-caption",`${file.beforeHash.slice(0,12)} → ${file.afterHash.slice(0,12)}`));list.append(row);}
    return contentDetails(`${label} · ${files.length}`,key,[list]);
  }
  function alternativeLabel(id,record) {return id==="baseline"?"Saved source":record?.candidate?.name || "Proposed change";}
  function alternativeStatus(status) {return {preparing:"Preparing",ready:"Ready to run",running:"Running",completed:"Finished",failed:"Failed",cancelled:"Stopped",interrupted:"Interrupted","not-run":"Not run"}[status] || "Unavailable";}
  function alternativeFacts(rows) {const facts=el("dl","visual-verification-facts");for(const [label,value] of rows)facts.append(el("dt","",label),el("dd","",value));return facts;}
  function alternativeImageKey(projectId,id,captureId) {return JSON.stringify([projectId,id,captureId]);}
  function clearAlternativeImages() {for(const value of alternativeImages.values())if(value.uri)URL.revokeObjectURL(value.uri);alternativeImages.clear();alternativeImageOwner=null;}
  function alternativeCaptureBinding(id,captureId) {return alternativeView()?.records.find(value=>value.id===id)?.variants.map(value=>value.outcome?.capture).find(value=>value?.id===captureId);}
  function requestAlternativeImageSet(bindings,owner) {
    const view=alternativeView();if(!view || bindings.length>2)return;
    if(alternativeImageOwner!==owner){clearAlternativeImages();alternativeImageOwner=owner;}
    for(const {record,capture} of bindings){if(!capture?.image || alternativeCaptureBinding(record.id,capture.id)?.image.sha256!==capture.image.sha256)continue;const key=alternativeImageKey(view.projectId,record.id,capture.id);if(alternativeImages.has(key))continue;
      alternativeImages.set(key,{projectId:view.projectId,id:record.id,captureId:capture.id,sha:capture.image.sha256,status:"loading",uri:null});vscode.postMessage({type:"visualAlternatives",action:"image",projectId:view.projectId,expectedRevision:view.revision,id:record.id,captureId:capture.id});
    }render();
  }
  function requestAlternativeImages(record) {
    const view=alternativeView(),current=view?.records.find(value=>value.id===record.id);if(!current)return;
    requestAlternativeImageSet(current.variants.map(variant=>({record:current,capture:variant.outcome?.capture})),JSON.stringify([view.projectId,current.id]));
  }
  async function receiveAlternativeImage(message) {
    const key=alternativeImageKey(message.projectId,message.id,message.captureId),entry=alternativeImages.get(key),capture=alternativeCaptureBinding(message.id,message.captureId);
    if(!entry || entry.status!=="loading" || entry.decoding || !capture || message.projectId!==state.project?.id || entry.sha!==capture.image?.sha256)return;
    const current=()=>alternativeImages.get(key)===entry && state.trusted && state.project?.id===entry.projectId && alternativeCaptureBinding(entry.id,entry.captureId)?.image.sha256===entry.sha;
    try {
      if(message.error)throw Error("unavailable");if(message.imageSha256!==entry.sha)return;entry.decoding=true;
      const encoded=message.pngBase64;if(typeof encoded!=="string" || encoded.length<76 || encoded.length>Math.ceil(16*1024*1024/3)*4 || encoded.length%4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw Error("invalid");
      const decoded=atob(encoded);if(decoded.length!==capture.image.byteLength || btoa(decoded)!==encoded)throw Error("invalid");const bytes=Uint8Array.from(decoded,char=>char.charCodeAt(0)),header=new DataView(bytes.buffer);
      if(![137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value) || header.getUint32(12)!==0x49484452 || header.getUint32(16)!==capture.image.widthPx || header.getUint32(20)!==capture.image.heightPx)throw Error("invalid");
      const hash=[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(value=>value.toString(16).padStart(2,"0")).join("");if(!current())return;if(hash!==entry.sha)throw Error("invalid");
      entry.uri=URL.createObjectURL(new Blob([bytes],{type:"image/png"}));entry.status="ready";
    }catch{if(!current())return;entry.status="error";}
    if(current())render();
  }
  function alternativeFigure(record,variant,label=alternativeLabel(variant.id,record),keyPrefix="alternatives/"+record.id) {
    const capture=variant.outcome?.capture;if(!capture?.image)return null;
    const key=alternativeImageKey(state.project.id,record.id,capture.id),cached=alternativeImages.get(key),figure=el("figure","runtime-capture alternative-capture");figure.setAttribute("aria-label",label+" pixel capture");figure.dataset.captureStatus=cached?.status || "not-loaded";
    const caption=el("figcaption","runtime-capture-caption");caption.append(el("strong","","Actual pixel capture"),el("time","feature-caption",formatHistoryTime(capture.capturedAt)));figure.append(caption);
    const frame=el("div","runtime-capture-frame"),status=el("p","feature-caption runtime-capture-placeholder",cached?.status==="error"?"The saved image is unavailable.":cached?.status==="loading"?"Loading saved image…":"Choose Show captures to load this saved image.");status.setAttribute("role","status");frame.append(status);figure.append(frame);
    if(cached?.uri){const img=el("img","runtime-capture-image");img.alt=label+" — "+record.scope.scenario.title;img.decoding="async";img.referrerPolicy="no-referrer";img.width=capture.image.widthPx;img.height=capture.image.heightPx;img.hidden=true;
      const fail=()=>{if(alternativeImages.get(key)===cached){URL.revokeObjectURL(cached.uri);cached.uri=null;cached.status="error";}img.remove();figure.dataset.captureStatus="error";status.hidden=false;status.textContent="The saved image could not be displayed.";};img.addEventListener("error",fail,{once:true});img.addEventListener("load",()=>{if(img.naturalWidth!==capture.image.widthPx || img.naturalHeight!==capture.image.heightPx){fail();return;}img.hidden=false;status.hidden=true;figure.dataset.captureStatus="ready";},{once:true});img.src=cached.uri;frame.append(img);}
    figure.append(lazyContentDetails("Capture details",keyPrefix+"/"+variant.id+"/capture",()=>[alternativeFacts(captureConditionRows(capture))]));return figure;
  }
  function alternativeSide(record,variant,options={}) {
    const side=el("section","visual-verification-side alternative-side");const label=options.label || alternativeLabel(variant.id,record),key=options.key || "alternatives/"+record.id;side.setAttribute("aria-label",label+" evidence");side.append(el("h3","",label));
    const changedFiles=groupAlternative(record)?alternativeFileList(record.source.files,"Changed files",key+"/files"):null;
    if(groupAlternative(record)){side.append(el("p","feature-caption",`${record.source.files.length} changed files`));}
    else if(options.candidate && record.candidate?.token)side.append(el("p","feature-caption alternative-token",record.candidate.token.name+" · "+record.path));
    const image=alternativeFigure(record,variant,label,key),imageContent=image || el("p","feature-caption",record.captureEach?"No saved pixel capture.":"Pixel capture was not requested.");
    if(options.imageFirst)side.append(imageContent);
    if(changedFiles)side.append(changedFiles);
    if(options.candidate){const controls=alternativeReviewControls(record,key);if(controls)side.append(controls);}
    const outcome=variant.outcome || {},observation=outcome.observation,replay=outcome.replay,capture=outcome.capture,requests=observation?.observations?.filter(value=>value.kind==="request") || [];
    side.append(alternativeFacts([["Execution",alternativeStatus(variant.status)],[groupAlternative(record)?"Source snapshot":"Source revision",String(groupAlternative(record)?variant.manifestDigest || "Not recorded":variant.id==="baseline"?record.beforeHash:record.afterHash).slice(0,12)],["Observation",observation ? {completed:"Recorded",cancelled:"Stopped",interrupted:"Interrupted",recording:"Recording"}[observation.status] || "Unavailable" : "Not recorded"],["Recipe callbacks",replay ? replay.status==="completed"?"Completed app callbacks":alternativeStatus(replay.status) : "Not recorded"],["Requests",observation ? `${requests.length} observed` : "Not recorded"],["Compilation","Not recorded"],["Visual assessment","Not assessed"],["Source to pixels","Unverified"]]));
    if(variant.reason)side.append(el("p","feature-caption warning",variant.reason));
    if(requests.length)side.append(lazyContentDetails("Observed requests",key+"/"+variant.id+"/requests",()=>requests.map(request=>el("p","feature-caption",`${request.method} ${request.url} · ${request.status===null?request.outcome:request.status} · ${Math.round(request.durationMs)} ms`))));
    if(replay)side.append(lazyContentDetails("Recipe steps",key+"/"+variant.id+"/steps",()=>[alternativeFacts((replay.steps || []).map(step=>[record.recipe.steps.find(value=>value.id===step.id)?.title || step.id,alternativeStatus(step.status)]))]));
    if(!options.imageFirst)side.append(imageContent);return side;
  }
  function safeAlternativeComparison(value) {
    const id=value=>typeof value==="string" && value.length>0 && value.length<=200 && !/[\u0000-\u001f]/.test(value);
    if(!value || value.version!==1 || !id(value.projectId) || ["leftId","rightId","comparedLeftId","comparedRightId"].some(key=>value[key]!==null && !id(value[key])))return null;
    return {version:1,projectId:value.projectId,leftId:value.leftId,rightId:value.rightId,comparedLeftId:value.comparedLeftId,comparedRightId:value.comparedRightId};
  }
  function alternativeComparisonDraft() {const view=alternativeView();return view ? alternativeComparisons.get(view.projectId) || {version:1,projectId:view.projectId,leftId:null,rightId:null,comparedLeftId:null,comparedRightId:null}:null;}
  function updateAlternativeComparison(patch) {
    const draft=alternativeComparisonDraft();if(!draft)return;const next=safeAlternativeComparison({...draft,...patch});if(!next)return;
    alternativeComparisons.delete(next.projectId);alternativeComparisons.set(next.projectId,next);while(alternativeComparisons.size>16)alternativeComparisons.delete(alternativeComparisons.keys().next().value);alternativeComparisonError=null;saveView();render();
  }
  function alternativePair(leftId,rightId) {return alternativeView()?.comparisonPairs?.find(value=>value.leftId===leftId && value.rightId===rightId);}
  function alternativePairReason(draft) {
    if(!draft?.leftId || !draft.rightId)return "Choose two retained results.";
    if(draft.leftId===draft.rightId)return "Choose two different results.";
    const view=alternativeView();if(![draft.leftId,draft.rightId].every(id=>view?.records.some(record=>record.id===id)))return "A selected result is unavailable. Choose another result.";
    const pair=alternativePair(draft.leftId,draft.rightId);return !pair ? "Comparison availability is not recorded for this pair." : pair.compatible!==true ? pair.reasons?.join(" ") || "These results cannot be compared." : "";
  }
  function alternativeName(record) {return record.candidate?.name || record.title || "Earlier alternative";}
  function alternativeReviewKey(record) {return JSON.stringify([state.project?.id,record.id,record.candidate?.metadataDigest]);}
  function alternativeReviewReason(record) {
    const view=alternativeView(),current=view?.records.find(value=>value.id===record.id),choice=view?.reviewChoices?.find(value=>value.id===record.id);
    if(!current)return "This retained result is unavailable.";
    if(!current.candidate || !/^[a-f0-9]{64}$/.test(current.candidate.metadataDigest || ""))return "This earlier comparison has no retained source proposal. Create a new alternative to review a change.";
    if(view.storage?.status!=="saved")return view.storage?.message || "Restore comparison storage before reviewing a change.";
    return choice?.canReview===true ? "" : choice?.reason || "Source review is unavailable for this alternative.";
  }
  function alternativeReviewControls(record,key) {
    const view=alternativeView();if(!Array.isArray(view?.reviewChoices))return null;
    const controls=el("div","alternative-review-controls"),reason=alternativeReviewReason(record),pending=pendingAlternativeAction?.action==="review" && pendingAlternativeAction.id===record.id || view.operation?.action==="review" && view.operation.id===record.id;
    const review=button(pending?"Preparing review…":groupAlternative(record)?"Review this group":"Review this change",()=>{
      const current=alternativeView()?.records.find(value=>value.id===record.id);if(!current || alternativeOperationBusy() || alternativeReviewReason(current))return;
      const latest=alternativeView(),message={type:"visualAlternatives",action:"review",projectId:latest.projectId,expectedRevision:latest.revision,id:current.id,metadataDigest:current.candidate.metadataDigest};
      alternativeReviewFeedback.delete(alternativeReviewKey(current));pendingAlternativeAction={...message};vscode.postMessage(message);render();
    },"button small");review.disabled=!pending && (alternativeOperationBusy() || Boolean(reason));review.setAttribute("aria-disabled",String(alternativeOperationBusy() || Boolean(reason)));review.dataset.artifactFocus=key+"/review";controls.append(review);
    const feedback=alternativeReviewFeedback.get(alternativeReviewKey(record));if(reason || feedback){const status=el("p","feature-caption",reason || feedback);status.setAttribute("role","status");controls.append(status);}return controls;
  }
  function alternativeComparisonPanel(view) {
    if(!Array.isArray(view.comparisonPairs))return null;
    const panel=el("section","alternative-comparison");panel.setAttribute("aria-label","Compare retained results");panel.append(el("h3","","Compare retained results"));
    const draft=alternativeComparisonDraft(),key="alternatives/"+view.projectId+"/comparison",busy=Boolean(view.busy || view.operation || pendingAlternativeComparison || pendingAlternativeAction),choices=el("div","alternative-choices");
    const options=[["","Choose result"],...view.records.map(record=>[record.id,alternativeName(record)+" · "+formatHistoryTime(record.createdAt)+" · "+alternativeStatus(record.status)])];
    choices.append(alternativeSelect("First result",draft.leftId,options,value=>updateAlternativeComparison({leftId:value || null}),key+"/left",busy),alternativeSelect("Second result",draft.rightId,options,value=>updateAlternativeComparison({rightId:value || null}),key+"/right",busy));panel.append(choices);
    const reason=alternativePairReason(draft),actions=el("div","feature-form-actions"),compare=button(pendingAlternativeComparison?"Opening comparison…":"Compare results",()=>{
      const latest=alternativeView(),current=alternativeComparisonDraft();if(!latest || latest.busy || latest.operation || pendingAlternativeAction || pendingAlternativeComparison || alternativePairReason(current))return;
      const message={type:"visualAlternatives",action:"compare",projectId:latest.projectId,expectedRevision:latest.revision,leftId:current.leftId,rightId:current.rightId};pendingAlternativeComparison={...message};alternativeComparisonError=null;vscode.postMessage(message);render();
    },"button");compare.disabled=Boolean(reason) && !pendingAlternativeComparison;compare.setAttribute("aria-disabled",String(Boolean(reason) || busy));compare.dataset.artifactFocus=key+"/compare";actions.append(compare);
    const swap=button("Swap",()=>updateAlternativeComparison({leftId:draft.rightId,rightId:draft.leftId}),"button small");swap.disabled=busy || !draft.leftId || !draft.rightId;swap.dataset.artifactFocus=key+"/swap";actions.append(swap);
    const clear=button("Clear",()=>{clearAlternativeImages();updateAlternativeComparison({leftId:null,rightId:null,comparedLeftId:null,comparedRightId:null});},"text-button");clear.disabled=busy || !draft.leftId && !draft.rightId && !draft.comparedLeftId;clear.dataset.artifactFocus=key+"/clear";actions.append(clear);panel.append(actions);
    const status=el("p","feature-caption",alternativeComparisonError?.projectId===view.projectId ? alternativeComparisonError.message : reason || "Opens retained evidence. No runtime or source action will run.");status.setAttribute("role","status");panel.append(status);
    if(!draft.comparedLeftId || !draft.comparedRightId)return panel;
    const pair=alternativePair(draft.comparedLeftId,draft.comparedRightId),left=view.records.find(value=>value.id===draft.comparedLeftId),right=view.records.find(value=>value.id===draft.comparedRightId);
    if(!pair?.compatible || !left || !right){panel.append(el("p","feature-caption warning",pair?.reasons?.join(" ") || "The previously compared results are unavailable. Choose a pair to compare."));return panel;}
    const result=el("div","alternative-compared-results");result.setAttribute("role","region");result.setAttribute("aria-label","Selected alternative comparison");result.dataset.comparisonLeft=left.id;result.dataset.comparisonRight=right.id;
    result.append(el("h3","",alternativeName(left)+" and "+alternativeName(right)),el("p","feature-caption",`${left.scope.screen.title} · ${left.scope.scenario.title} · ${left.recipe.title}`),el("p","feature-caption",matrixConditionLabel(left.requested)+" · 680 px height"));
    if(draft.leftId!==left.id || draft.rightId!==right.id)result.append(el("p","feature-caption","Showing the previous comparison. Compare results to view your selection."));
    for(const difference of pair.observedDifferences || [])result.append(el("p","feature-caption warning",difference));
    const records=[left,right],captures=records.flatMap(record=>{const capture=record.variants.find(value=>value.id==="alternative")?.outcome?.capture;return capture?[{record,capture}]:[];});
    if(captures.length){const images=button("Show captures",()=>{const current=alternativeComparisonDraft();if(current?.comparedLeftId!==left.id || current?.comparedRightId!==right.id || alternativePair(left.id,right.id)?.compatible!==true)return;requestAlternativeImageSet(captures,JSON.stringify([view.projectId,"pair",left.id,right.id]));},"button small");images.dataset.artifactFocus=key+"/images";result.append(images);}
    const sides=el("div","alternative-sides alternative-candidate-sides");for(const [index,record] of records.entries()){const variant=record.variants.find(value=>value.id==="alternative");if(variant)sides.append(alternativeSide(record,variant,{imageFirst:true,candidate:true,label:alternativeName(record),key:key+"/"+(index===0?"left":"right")+"/"+record.id}));}result.append(sides,el("p","feature-caption","Each result retains its own evidence. Review a change to open a source proposal; Apply remains separate."));panel.append(result);return panel;
  }
  function receiveAlternativeComparison(message) {
    const pending=pendingAlternativeComparison,view=alternativeView();if(!pending || !view || ["projectId","leftId","rightId","expectedRevision"].some(key=>message[key]!==pending[key]) || message.projectId!==view.projectId)return;
    const draft=alternativeComparisonDraft();if(draft.leftId!==pending.leftId || draft.rightId!==pending.rightId){pendingAlternativeComparison=null;return;}
    pendingAlternativeComparison=null;const current=alternativePair(message.leftId,message.rightId),pair=message.comparison;
    if(message.error || !current || !pair || JSON.stringify(current)!==JSON.stringify(pair) || pair.compatible!==true){alternativeComparisonError={projectId:view.projectId,message:typeof message.error==="string"?message.error:pair?.reasons?.join(" ") || "Comparison availability changed. Review the selected results."};render();return;}
    clearAlternativeImages();updateAlternativeComparison({comparedLeftId:pending.leftId,comparedRightId:pending.rightId});
  }
  function receiveAlternativeReview(message) {
    const pending=pendingAlternativeAction,view=alternativeView();if(!pending || pending.action!=="review" || !view || ["projectId","id","metadataDigest"].some(key=>message[key]!==pending[key]) || message.projectId!==view.projectId)return;
    const record=view.records.find(value=>value.id===pending.id);pendingAlternativeAction=null;if(record?.candidate?.metadataDigest===pending.metadataDigest){alternativeReviewFeedback.set(alternativeReviewKey(record),typeof message.error==="string"?message.error:(message.proposalId || message.changeSetId)?"Opened for source review. Apply remains separate.":"Source review could not be confirmed.");while(alternativeReviewFeedback.size>16)alternativeReviewFeedback.delete(alternativeReviewFeedback.keys().next().value);}render();
  }
  function alternativeHistory() {
    const view=alternativeView();if(!view || !view.records.length && !view.error && !["error","unavailable"].includes(view.storage?.status))return null;
    const section=el("section","surface alternative-history");section.setAttribute("aria-label","Visual alternatives");section.append(sectionHeading("Alternatives",view.records.length));const compared=alternativeComparisonPanel(view);if(compared)section.append(compared);
    if(state.proposal?.origin!=="design" || state.proposal.status!=="proposed"){const notice=alternativeStorageNotice(view);if(notice)section.append(notice);}
    for(const record of view.records){const key="alternatives/"+view.projectId+"/record/"+record.id;
      if(pendingAlternativeReveal===key){disclosureState.set(key,true);pendingAlternativeReveal=null;}
      section.append(lazyContentDetails(alternativeName(record)+" · "+alternativeStatus(record.status),key,()=>{
        const body=el("div","alternative-record");body.dataset.alternativeRecord=record.id;
        body.append(el("p","feature-caption",`${record.scope.screen.title} · ${record.scope.scenario.title}`),el("p","feature-caption",`${record.recipe.title} · ${matrixConditionLabel(record.requested)} · 680 px height`),el("p","feature-caption",(groupAlternative(record)?`${record.source.files.length} changed files`:record.path)+" · Prepared "+formatHistoryTime(record.createdAt)));
        if(record.status==="ready"){const run=button(pendingAlternativeAction?.action==="run"&&pendingAlternativeAction.id===record.id?"Starting comparison…":"Run comparison",()=>alternativeAction("run",record),"button primary");run.disabled=view.storage?.status!=="saved";run.setAttribute("aria-disabled",String(Boolean(view.busy || pendingAlternativeAction || run.disabled)));run.dataset.artifactFocus=key+"/run";body.append(run,el("p","feature-caption","Runs the app recipe once in each copy. The original project is not changed."));}
        if(record.reason)body.append(el("p","feature-caption warning",record.reason));
        if(record.variants.some(value=>value.outcome?.capture)){const show=button("Show captures",()=>requestAlternativeImages(record),"button small");show.dataset.artifactFocus=key+"/images";body.append(show);}
        const pair=el("div","alternative-sides");for(const id of ["baseline","alternative"]){const variant=record.variants.find(value=>value.id===id);if(variant)pair.append(alternativeSide(record,variant,{candidate:variant.id==="alternative"}));}body.append(pair);
        body.append(lazyContentDetails("Frozen comparison scope",key+"/scope",()=>[alternativeFacts([["Feature",record.scope.feature.title],["Scenario revision",String(record.scope.definitionRevision)],["Recipe fixture",record.recipe.fixture.label],["Recipe catalog",record.recipe.catalogDigest],...(groupAlternative(record)?[["Source group",record.source.groupId],["Group revision",String(record.source.groupRevision)],["Group digest",record.source.groupDigest]]:[["Saved source",record.beforeHash],["Proposed source",record.afterHash]]),["Saved-copy manifest",record.baselineDigest || "Not recorded"]])])) ;return [body];
      },"content-details alternative-record-details"));
    }return section;
  }
  function reconcileAlternatives() {
    const view=alternativeView(),pending=pendingAlternativeAction;
    if(pending){
      if(!view || pending.projectId!==view.projectId || view.error || ["error","unavailable"].includes(view.storage?.status))pendingAlternativeAction=null;
      else if(pending.action==="prepare"){
        const record=view.records.find(value=>!pending.existingIds.includes(value.id) && (pending.sourceKind==="change-set"?groupAlternative(value) && value.source.groupId===pending.proposalId:!groupAlternative(value) && value.proposalId===pending.proposalId) && (!value.candidate || value.candidate.name===pending.candidateName) && value.scope.scenario.id===pending.scenarioId && value.recipe.id===pending.recipeId && value.captureEach===pending.captureEach && ["theme","motion","viewportWidthCss","viewportHeightCss"].every(key=>value.requested[key]===pending.requested[key]));
        if(view.storage?.status==="saved" && view.revision>pending.expectedRevision && record && record.status!=="preparing"){
          if(record.status==="ready")pendingAlternativeReveal="alternatives/"+view.projectId+"/record/"+record.id;
          pendingAlternativeAction=null;
        }
      }else if(pending.action!=="review" && (pending.action==="stop" ? !view.busy : pending.action==="retry" ? !view.busy && view.storage?.status==="saved" : view.busy || view.revision>pending.expectedRevision))pendingAlternativeAction=null;
    }
    if(pendingAlternativeComparison && (!view || pendingAlternativeComparison.projectId!==view.projectId || view.error)){pendingAlternativeComparison=null;}
    for(const [key,value] of alternativeImages){if(!view || value.projectId!==view.projectId || alternativeCaptureBinding(value.id,value.captureId)?.image.sha256!==value.sha){if(value.uri)URL.revokeObjectURL(value.uri);alternativeImages.delete(key);}}
    if(!view || !view.busy){alternativePreviewHint=null;alternativeWitness=null;alternativeAcknowledgment=null;clearTimeout(alternativeWitnessTimer);}
  }
  function activeAlternative() {
    const view=alternativeView(),active=view?.active,record=view?.records.find(value=>value.id===active?.comparisonId);
    return !assistantSurface && view?.busy && active && record?.status==="running" && record.variants.some(value=>value.id===active.variantId) && ["connect","ready","capture"].includes(active.phase) && typeof active.nonce==="string" && /^[a-f0-9-]{32,36}$/.test(active.nonce) && validMatrixConditions(active.requested) && ["theme","motion","viewportWidthCss","viewportHeightCss"].every(key=>active.requested[key]===record.requested[key]) ? active : null;
  }
  function alternativeURL(runtime) {try{const url=new URL(runtime?.url);return ["http:","https:"].includes(url.protocol) && ["127.0.0.1","localhost","[::1]"].includes(url.hostname) && !url.username && !url.password ? url : null;}catch{return null;}}
  function alternativePreviewCurrent() {
    const active=activeAlternative(),hint=alternativePreviewHint,url=alternativeURL(active?.runtime);
    return state.mode==="Review" && document.visibilityState==="visible" && active && hint?.projectId===state.project?.id && url && alternativeFrame?.isConnected && !alternativesSlot?.hidden && ["comparisonId","variantId","nonce","phase"].every(key=>hint[key]===active[key]) && ["theme","motion","viewportWidthCss","viewportHeightCss"].every(key=>hint.requested?.[key]===active.requested[key]) && ["session","viewId","documentId","pageVersion","pagePath","url"].every(key=>hint.runtime?.[key]===active.runtime?.[key]) && alternativeFrame.src===url.href ? active : null;
  }
  function fitAlternativeCanvas() {
    const active=activeAlternative(),canvas=alternativesSlot?.querySelector(".alternative-canvas"),viewport=canvas?.firstElementChild;if(!active || !canvas || !viewport || alternativesSlot.hidden || state.mode!=="Review")return;
    const width=active.requested.viewportWidthCss,height=active.requested.viewportHeightCss,scale=Math.min(1,Math.max(1,canvas.clientWidth-32)/width,Math.max(1,Math.min(560,innerHeight-240))/height);
    viewport.style.width=`${width*scale}px`;viewport.style.height=`${height*scale}px`;alternativeFrame.style.transform=`scale(${scale})`;
  }
  function requestAlternativeWitness() {
    clearTimeout(alternativeWitnessTimer);const active=alternativePreviewCurrent();if(!active)return;
    const key=JSON.stringify([state.project.id,active.comparisonId,active.variantId,active.nonce]);if(alternativeAcknowledgment===key)return;
    const url=alternativeURL(active.runtime);alternativeFrame.contentWindow.postMessage({type:"foundation-runtime-control",session:active.runtime.session,inspect:false,theme:active.requested.theme},url.origin);
    const nonce=alternativeWitness?.key===key?alternativeWitness.nonce:[...crypto.getRandomValues(new Uint8Array(16))].map(value=>value.toString(16).padStart(2,"0")).join("");if(alternativeWitness?.key!==key)alternativeWitness={key,nonce};
    alternativeFrame.contentWindow.postMessage({type:"foundation-runtime-preview-witness",session:active.runtime.session,viewId:active.runtime.viewId,nonce},url.origin);
    alternativeWitnessTimer=setTimeout(requestAlternativeWitness,250);
  }
  function receiveAlternativeWitness(event) {
    const active=alternativePreviewCurrent(),message=event.data,url=alternativeURL(active?.runtime);if(!active || event.origin!==url?.origin || !alternativeWitness || message?.type!=="foundation-runtime-preview-witness" || message.nonce!==alternativeWitness.nonce || message.session!==active.runtime.session || message.viewId!==active.runtime.viewId || !/^[a-f0-9]{32}$/.test(message.documentId || "") || !Number.isInteger(message.pageVersion) || message.pageVersion<0 || typeof message.route!=="string" || !message.route.startsWith("/") || message.route.length>2048 || message.ready!==true || message.inspect!==false || !Number.isInteger(message.viewportWidth) || !Number.isInteger(message.viewportHeight) || Math.abs(message.viewportWidth-active.requested.viewportWidthCss)>1 || Math.abs(message.viewportHeight-active.requested.viewportHeightCss)>1 || message.requestedTheme!==active.requested.theme)return;
    if(active.runtime.documentId && (message.documentId!==active.runtime.documentId || message.pageVersion!==active.runtime.pageVersion || message.route!==active.runtime.pagePath))return;
    const witness=alternativeWitness,key=witness.key;fitAlternativeCanvas();alternativesSlot.scrollIntoView({block:"start",behavior:"instant"});
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      if(alternativeWitness!==witness || alternativeAcknowledgment===key || !alternativePreviewCurrent())return;
      fitAlternativeCanvas();const rect=alternativeFrame.getBoundingClientRect(),main=mainSurface.getBoundingClientRect();if(rect.width<=0 || rect.height<=0 || rect.left<Math.max(0,main.left) || rect.top<Math.max(0,main.top) || rect.right>Math.min(innerWidth,main.right)+0.01 || rect.bottom>Math.min(innerHeight,main.bottom)+0.01)return;
      alternativeAcknowledgment=key;clearTimeout(alternativeWitnessTimer);vscode.postMessage({type:"visualAlternativesPreviewReady",projectId:state.project.id,comparisonId:active.comparisonId,variantId:active.variantId,nonce:active.nonce,phase:active.phase,session:message.session,viewId:message.viewId,documentId:message.documentId,pageVersion:message.pageVersion,route:message.route,requested:{...active.requested}});
    }));
  }
  function updateAlternativeCanvas() {
    const view=alternativeView(),active=activeAlternative(),reviewOperation=view?.operation?.action==="review"?view.operation:pendingAlternativeAction?.action==="review"?pendingAlternativeAction:null,record=view?.records.find(value=>reviewOperation?value.id===reviewOperation.id:value.status==="running" || value.status==="preparing"),visible=Boolean(!assistantSurface && (view?.busy || reviewOperation) && record);
    alternativesSlot.hidden=!visible;alternativesSlot.inert=!visible;
    if(!visible){alternativeResizeObserver?.disconnect();alternativesSlot.replaceChildren();alternativeFrame=null;alternativeFrameKey=null;return;}
    if(!alternativesSlot.childNodes.length){alternativesSlot.setAttribute("aria-label","Running comparison");alternativesSlot.append(el("div","alternative-live-heading"),el("div","alternative-canvas design-canvas"));alternativeResizeObserver=new ResizeObserver(fitAlternativeCanvas);alternativeResizeObserver.observe(alternativesSlot);}
    const heading=alternativesSlot.firstElementChild,copy=el("div");copy.append(el("strong","",reviewOperation?"Preparing source review":active?`${alternativeLabel(active.variantId,record)} · ${active.variantId==="baseline"?"1":"2"} of 2`:record.status==="preparing"?"Preparing comparison":"Running comparison"),el("p","feature-caption",active?`${record.scope.scenario.title} · ${matrixConditionLabel(active.requested)}`:alternativeName(record)));
    const controls=el("div","feature-form-actions"),stop=button(pendingAlternativeAction?.action==="stop"?"Stopping…":reviewOperation?"Cancel review":"Stop comparison",()=>alternativeAction("stop",record),"button small");stop.disabled=pendingAlternativeAction?.action==="stop";stop.dataset.artifactFocus="alternatives/stop";controls.append(stop);
    if(state.mode!=="Review")controls.prepend(button("View comparison",()=>setMode("Review"),"button small"));heading.replaceChildren(copy,controls);
    const canvas=alternativesSlot.lastElementChild,url=alternativeURL(active?.runtime),key=active&&url?JSON.stringify([view.projectId,active.comparisonId,active.variantId,active.runtime.session,active.runtime.viewId,url.href]):null;
    canvas.hidden=state.mode!=="Review" || !key;canvas.inert=canvas.hidden;
    if(key!==alternativeFrameKey){canvas.replaceChildren();alternativeFrame=null;alternativeFrameKey=key;alternativeWitness=null;alternativeAcknowledgment=null;clearTimeout(alternativeWitnessTimer);
      if(key){const viewport=el("div","alternative-viewport design-viewport");alternativeFrame=el("iframe");alternativeFrame.setAttribute("data-foundation-alternative-canvas","");alternativeFrame.title=alternativeLabel(active.variantId)+" isolated preview";alternativeFrame.setAttribute("sandbox","allow-scripts allow-same-origin allow-forms");alternativeFrame.setAttribute("referrerpolicy","no-referrer");alternativeFrame.width=String(active.requested.viewportWidthCss);alternativeFrame.height="680";alternativeFrame.addEventListener("load",()=>{fitAlternativeCanvas();requestAlternativeWitness();});alternativeFrame.src=url.href;viewport.append(alternativeFrame);canvas.append(viewport);}
    }
    if(alternativeFrame)alternativeFrame.toggleAttribute("data-foundation-runtime-canvas",!canvas.hidden);
    if(!canvas.hidden){fitAlternativeCanvas();requestAlternativeWitness();}
  }
  window.addEventListener("pagehide",()=>{clearAlternativeImages();clearTimeout(alternativeWitnessTimer);});
  document.addEventListener("visibilitychange",requestAlternativeWitness);
  function proposalReview(proposal, compact = false, embedded = false) {
    const section = el("section", compact ? "proposal-card compact" : "proposal-card");
    const heading = el("div", "proposal-heading");
    const copy = el("div");
    copy.append(el("span", "proposal-origin", proposal.origin === "design" ? "Design token change" : "AI change proposal"), el("h2", "", proposal.title || "Proposed source change"));
    heading.append(copy, badge(proposal.status === "proposed" ? "Ready to review" : proposal.status || "Proposed", proposal.status === "stale" ? "unknown" : "source"));
    if (!embedded) {
      section.append(heading, el("p", "proposal-summary", proposal.summary || "Review the proposed change before it touches source."));
      section.append(el("div", "proposal-scope", `1 file · ${proposal.path} · baseline ${String(proposal.baseRevision || "").slice(0, 7)}`));
    }
    const impact=proposalDesignImpact(proposal);if(impact)section.append(impact);
    const artifactView = artifacts.proposalState(proposal, proposal.planBasis?artifactFiles():sourceFiles(), state.dirtyPaths, state.running, currentProposalId());
    if (!embedded && artifactView.reason) section.append(note(artifactView.reason, "warning"));
    const actions = el("div", "proposal-actions");
    const command = (type) => {if(type!=="proposalDiff" && alternativeOperationBusy())return;vscode.postMessage({ type, id: proposal.id });};
    actions.append(button("Open native diff", () => command("proposalDiff"), "button", "review"));
    if (proposal.status === "proposed") {
      const apply = button("Apply to source", () => command("proposalApply"), "button primary", "check");
      apply.disabled = !artifactView.canApply;
      actions.append(apply, button("Discard", () => command("proposalDiscard"), "text-button"));
    } else if (proposal.status === "applied") {
      const undo = button("Undo Foundation change", () => command("proposalUndo"), "button");
      undo.disabled = !artifactView.canUndo;
      actions.append(undo, button("Inspect result", () => { if(alternativeOperationBusy())return;closeArtifact(); state.designEntry = state.design?.entry || chosenEntry(); setMode("Refine"); beginDesign(); }, "button", "inspect"),
        button("Dismiss checkpoint", () => command("proposalDiscard"), "text-button"));
      section.append(el("p", "checkpoint-note", "Dismissing this checkpoint leaves the applied source unchanged."));
    } else if (proposal.status === "stale") actions.append(button("Discard", () => command("proposalDiscard"), "text-button"));
    for (const control of actions.querySelectorAll("button")) {control.dataset.artifactFocus = `proposal/${proposal.id}:${control.textContent}`;if(alternativeOperationBusy() && control.textContent!=="Open native diff"){control.disabled=true;control.title="Stop the comparison before changing this proposal.";}}
    section.append(actions);
    const alternatives=alternativePanel(proposal);if(alternatives)section.append(alternatives);
    const verification=visualVerificationPanel(proposal);if(verification)section.append(verification);
    if (!compact) {
      const details = el("details", "proposal-diff");
      const diffKey = `proposal/${proposal.id}:diff`;
      details.open = disclosureState.has(diffKey) ? disclosureState.get(diffKey) === true : embedded;
      details.addEventListener("toggle", () => disclosureState.set(diffKey, details.open));
      const summary = el("summary", "", "Compare proposed source");
      summary.dataset.artifactFocus = diffKey;
      details.append(summary);
      const split = el("div", "proposal-diff-columns");
      for (const [label, source] of [["Before", proposal.before], ["After", proposal.after]]) {
        const column = el("div"); column.append(el("h3", "", label), el("pre", "", source || "")); split.append(column);
      }
      details.append(split); section.append(details);
      if (!embedded && proposal.verification?.length) {
        const checks = el("div", "proposal-checklist"); checks.append(el("h3", "", "Suggested verification"));
        const list = el("ul");
        for (const item of proposal.verification.slice(0, 12)) list.append(el("li", "", item));
        checks.append(list, el("p", "quiet", "Suggestions have not been run.")); section.append(checks);
      }
    }
    return section;
  }
  // Knowledge is a local index over existing journals. Opening, searching and
  // following relationships never shares context or starts runtime work.
  function knowledgeDraft() {
    const api=window.FoundationKnowledge;if(!api || !state.project?.id)return null;
    if(!knowledgeState || knowledgeState.projectId!==state.project.id)knowledgeState=api.normalize(persisted.knowledge,state.project.id);
    return knowledgeState;
  }
  function knowledgeItems() {return state.trusted&&window.FoundationKnowledge?window.FoundationKnowledge.project({projectId:state.project?.id,decisions:decisionView(),issues:issueView()}):[];}
  function knowledgeRecord(item) {return (item?.kind==="decision"?decisionView():item?.kind==="issue"?issueView():null)?.records.find(value=>value.record.id===item.id&&value.digest===item.digest) || null;}
  function understandNavigation() {
    const nav=el("nav","understand-navigation");nav.setAttribute("aria-label","Understand view");
    for(const [label,open] of [["Source",false],["Knowledge",true]]){const b=button(label,()=>{knowledgeOpenProjectId=open?state.project?.id:null;knowledgeNotice="";knowledgeFocusSearch=open;saveView();render();},"button small");b.setAttribute("aria-pressed",String(open===(knowledgeOpenProjectId===state.project?.id)));b.dataset.knowledgeAction=open?"open":"source";b.dataset.designFocus="knowledge/nav/"+label;nav.append(b);}return nav;
  }
  function updateKnowledge(patch) {const draft=knowledgeDraft();if(!draft)return;knowledgeState=window.FoundationKnowledge.normalize({...draft,...patch},state.project.id);knowledgeNotice="";saveView();refreshKnowledgePage();}
  function selectKnowledge(key) {const item=knowledgeItems().find(value=>value.key===key);if(!item)return;updateKnowledge({selectedKey:key});knowledgeCache?.detail.querySelector("h2")?.focus({preventScroll:true});}
  function prepareKnowledge(item) {
    const current=knowledgeItems().find(value=>value.key===item.key);
    if(pendingKnowledgeContext || !current?.canShare || current.digest!==item.digest)return;
    pendingKnowledgeContext={type:"knowledgeContext",action:"prepare",projectId:state.project.id,kind:item.kind,id:item.id,digest:item.digest};knowledgeNotice="Checking context…";vscode.postMessage(pendingKnowledgeContext);render();
  }
  function knowledgePage() {
    const projectId=state.project.id;
    if(!knowledgeCache || knowledgeCache.projectId!==projectId){
      const page=el("div","knowledge-page"),heading=el("div","page-heading knowledge-heading");
      heading.append(el("h1","","Project knowledge"),el("p","feature-caption","Decisions and issues, connected to their source and evidence."));
      const controls=el("div","knowledge-controls"),searchLabel=el("label","knowledge-search"),search=el("input");search.type="search";search.maxLength=256;search.placeholder="Search decisions, issues, or source…";search.setAttribute("aria-label","Search knowledge");search.dataset.designFocus="knowledge/search";search.addEventListener("input",()=>updateKnowledge({query:search.value}));searchLabel.append(icon("search",16),search);controls.append(searchLabel);
      const selects={};for(const [field,label] of [["kind","Kind"],["featureId","Feature"],["status","Status"]]){const wrap=el("label","knowledge-filter"),select=el("select");select.setAttribute("aria-label","Knowledge "+(field==="featureId"?"feature":field));select.dataset.designFocus="knowledge/"+field;select.addEventListener("change",()=>updateKnowledge({[field]:select.value}));wrap.append(el("span","feature-caption",label),select);controls.append(wrap);selects[field]=select;}
      const notice=el("div","knowledge-notices"),body=el("div","knowledge-body"),results=el("section","knowledge-results"),detail=el("section","knowledge-detail");results.setAttribute("aria-label","Knowledge results");detail.setAttribute("aria-label","Knowledge detail");body.append(results,detail);page.append(understandNavigation(),heading,controls,notice,body);knowledgeCache={projectId,page,search,selects,notice,results,detail};
    }
    refreshKnowledgePage();return knowledgeCache.page;
  }
  function knowledgeOptions(select,options,value) {
    const signature=JSON.stringify(options);if(select.dataset.options!==signature){select.replaceChildren(...options.map(([id,title])=>{const option=el("option","",title);option.value=id;return option;}));select.dataset.options=signature;}select.value=value;
  }
  function refreshKnowledgePage() {
    const cache=knowledgeCache,draft=knowledgeDraft();if(!cache || !draft || cache.projectId!==state.project?.id)return;
    const items=knowledgeItems(),results=window.FoundationKnowledge.search(items,draft),features=new Map(items.map(item=>[item.feature.id,item.feature.title]));
    if(draft.featureId!=="all"&&!features.has(draft.featureId))features.set(draft.featureId,"Unavailable feature");
    if(cache.search.value!==draft.query)cache.search.value=draft.query;
    knowledgeOptions(cache.selects.kind,[["all","All records"],["decision","Decisions"],["issue","Issues"]],draft.kind);
    knowledgeOptions(cache.selects.featureId,[["all","All features"],...[...features].sort((a,b)=>a[1].localeCompare(b[1]))],draft.featureId);
    knowledgeOptions(cache.selects.status,[["all","Any status"],["current","Current"],["historical","Historical"],["unavailable","Unavailable"]],draft.status);
    cache.notice.replaceChildren();
    for(const [kind,view] of [["decision",decisionView()],["issue",issueView()]])if(view && (view.error || ["error","unavailable"].includes(view.storage?.status))){const row=el("div","knowledge-storage"),text=el("p","feature-caption",view.error || view.storage.message || `${kind==="decision"?"Decision":"Issue"} storage is unavailable. Saved history is preserved.`);text.setAttribute("role","status");const retry=button(`Retry ${kind} storage`,()=>kind==="decision"?decisionAction("retry"):issueAction("retry"),"button small");retry.disabled=Boolean(view.busy);retry.dataset.designFocus="knowledge/retry/"+kind;row.append(text,retry);cache.notice.append(row);}
    if(knowledgeNotice){const message=el("p","feature-caption",knowledgeNotice);message.setAttribute("role","status");cache.notice.append(message);}
    cache.results.replaceChildren();const count=el("p","knowledge-count",`${results.length} ${results.length===1?"record":"records"}`);count.setAttribute("role","status");cache.results.append(count);
    if(!decisionView()&&!issueView())cache.results.append(el("p","empty-copy","Loading project knowledge…"));
    else if(!items.length)cache.results.append(el("h2","","No project knowledge yet"),el("p","empty-copy","Record a decision after applying an alternative, or capture an issue from a finished observation."));
    else if(!results.length){cache.results.append(el("h2","","No matching records"),el("p","empty-copy","Try another phrase or clear the filters."));const clear=button("Clear search and filters",()=>updateKnowledge({query:"",kind:"all",featureId:"all",status:"all"}),"button small");clear.dataset.knowledgeAction="clear";cache.results.append(clear);}
    for(const item of results){const row=button("",()=>selectKnowledge(item.key),"knowledge-result");row.dataset.knowledgeKey=item.key;row.dataset.knowledgeAction="select";row.dataset.designFocus="knowledge/result/"+item.key;row.setAttribute("aria-pressed",String(draft.selectedKey===item.key));row.setAttribute("aria-label",item.title);const meta=el("span","knowledge-result-meta");meta.append(el("span","",item.kind==="decision"?"Decision":"Issue"),el("span","",item.status));row.append(meta,el("strong","",item.title),el("span","knowledge-result-summary",item.summary),el("small","",item.feature.title));cache.results.append(row);}
    cache.detail.replaceChildren();cache.detail.removeAttribute("data-knowledge-selected");
    const selected=items.find(item=>item.key===draft.selectedKey),record=knowledgeRecord(selected);
    if(!selected || !record){cache.detail.append(el("h2","",draft.selectedKey?"Record unavailable":"Choose a record"),el("p","empty-copy",draft.selectedKey?"The saved selection is no longer available in this project. Choose another record to continue.":"Read its rationale or reported outcome, then follow the supporting source and evidence."));return;}
    cache.detail.dataset.knowledgeSelected=selected.key;
    const top=el("div","knowledge-detail-heading"),title=el("h2","",selected.title);title.tabIndex=-1;const meta=el("p","feature-caption",`${selected.kind==="decision"?"Decision":"Issue"} · ${selected.status} · ${formatHistoryTime(selected.createdAt)}`);top.append(meta,title);cache.detail.append(top);
    if(!results.some(item=>item.key===selected.key))cache.detail.append(el("p","feature-caption","Selected record is outside the current results."));
    const use=button("Use in Assistant",()=>prepareKnowledge(selected),"button small","spark");use.dataset.knowledgeAction="share";use.dataset.knowledgeKey=selected.key;use.dataset.designFocus="knowledge/share/"+selected.key;use.disabled=!selected.canShare || Boolean(pendingKnowledgeContext);cache.detail.append(use);
    if(!selected.canShare&&selected.reason)cache.detail.append(el("p","feature-caption",selected.reason));
    cache.detail.append(selected.kind==="decision"?decisionRecordBody(record,"knowledge/"+selected.key):issueRecordBody(record,"knowledge/"+selected.key));
    const relations=window.FoundationKnowledge.related(items,selected.key);if(relations.length){const related=el("section","knowledge-related");related.setAttribute("aria-label","Related knowledge");related.append(el("h3","","Related records"));for(const relation of relations){const item=items.find(value=>value.key===relation.key);if(!item)continue;const link=button("",()=>selectKnowledge(item.key),"knowledge-related-link");link.dataset.knowledgeKey=item.key;link.dataset.knowledgeRelated=item.key;link.dataset.knowledgeAction="select";link.dataset.designFocus="knowledge/related/"+item.key;link.append(el("strong","",item.title),el("small","",relation.reason));related.append(link);}related.append(el("p","feature-caption","Shared references show a connection, not a causal relationship."));cache.detail.append(related);}
  }
  function receiveKnowledgeContext(message) {
    const fields=["prepareId","projectId","featureId","conversationId","kind","id","digest"],reply={type:"knowledgeContextApplied"};for(const key of fields)reply[key]=message[key];
    if(typeof message.prepareId!=="string" || !message.prepareId || appliedKnowledgeOffers.has(message.prepareId))return;
    appliedKnowledgeOffers.add(message.prepareId);while(appliedKnowledgeOffers.size>32)appliedKnowledgeOffers.delete(appliedKnowledgeOffers.values().next().value);
    let reason="";const identity=assistantIdentity();
    if(!assistantSurface || !state.trusted || !matchingAssistantIdentity(message,identity))reason="Assistant context changed. Return to Knowledge and try again.";
    else if(state.running || pendingAssistantRestore || state.contextRestoreLoading || !coldAssistantContextResolved)reason="Wait for the Assistant draft to finish restoring, then try again.";
    else if(state.checkContext || state.investigationContext || state.continuationContext || state.groupRevision || state.requestRevision || state.planContext || state.alternativeGenerationDraft)reason="Finish or remove the prepared request before adding knowledge.";
    const item=knowledgeItems().find(value=>value.kind===message.kind&&value.id===message.id&&value.digest===message.digest);
    if(!reason && (!item?.canShare || item.feature.id!==identity?.featureId))reason="This record is no longer available for the selected feature.";
    const selected=message.kind==="decision"?state.decisionContext:state.issueContext,existing=selected.find(value=>value.id===message.id);
    if(!reason && existing&&existing.digest!==message.digest)reason="Remove the earlier selected snapshot before adding this record.";
    if(!reason && !existing && selected.length>=(message.kind==="decision"?4:1))reason=message.kind==="decision"?"Remove a selected decision before adding another.":"Remove the selected issue before adding another.";
    if(!reason){if(!existing)selected.push({id:message.id,digest:message.digest});markAssistantDraftEdited();state.sidebarContextOpen=true;state.sourceExpanded=true;knowledgeNotice="";saveView();renderAssistant();composer?.focus({preventScroll:true});}
    else reply.error=reason;
    vscode.postMessage(reply);
  }

  // Decisions retain the user's reason and exact adoption evidence. Their
  // projection controls availability; viewing one never shares or changes it.
  function decisionView() {
    const view=state.projectDecisions;
    return state.trusted && view?.schemaVersion===1 && view.projectId===state.project?.id && Number.isSafeInteger(view.revision) && Array.isArray(view.records)?view:null;
  }
  function decisionStatus(item) {
    const status=item?.status;
    return status?.supersededBy?"Superseded":status?.adoption==="undone"?"Not applied":!status || status.source==="missing" || status.adoption==="missing" || status.evidence==="missing"?"Unavailable":status.source==="stale" || status.scope==="stale" || status.evidence==="changed"?"Stale":"Current";
  }
  function validDecisionSelections(value) {
    return Array.isArray(value) && value.length<=4 && new Set(value.map(item=>item?.id)).size===value.length && value.every(item=>item && Object.keys(item).every(key=>["id","digest"].includes(key)) && validAssistantIdentity(item.id) && /^[a-f0-9]{64}$/.test(item.digest || ""));
  }
  function safeDecisionDraft(value) {
    return value && validAssistantIdentity(value.projectId) && validAssistantIdentity(value.candidateId) && /^[a-f0-9]{64}$/.test(value.candidateDigest || "") && typeof value.title==="string" && value.title.length<=120 && typeof value.rationale==="string" && value.rationale.length<=2000 && (value.supersedesId===null || validAssistantIdentity(value.supersedesId)) ? {projectId:value.projectId,candidateId:value.candidateId,candidateDigest:value.candidateDigest,title:value.title,rationale:value.rationale,supersedesId:value.supersedesId}:null;
  }
  function decisionDraftKey(value) {return JSON.stringify([value.projectId,value.candidateId,value.candidateDigest]);}
  function decisionDraft(candidate) {
    const blank={projectId:state.project.id,candidateId:candidate.id,candidateDigest:candidate.digest,title:candidate.title.slice(0,120),rationale:"",supersedesId:null},key=decisionDraftKey(blank);
    if(!decisionDrafts.has(key))decisionDrafts.set(key,blank);return decisionDrafts.get(key);
  }
  function saveDecisionDraft(draft) {const key=decisionDraftKey(draft);decisionDrafts.delete(key);decisionDrafts.set(key,draft);while(decisionDrafts.size>16)decisionDrafts.delete(decisionDrafts.keys().next().value);saveView();}
  function decisionAction(action,extra={}) {
    const view=decisionView();if(!view || view.busy || pendingDecisionAction)return;
    if(action==="record" && (view.storage?.status!=="saved" || view.candidate?.canRecord!==true || view.candidate.id!==extra.candidateId || view.candidate.digest!==extra.candidateDigest))return;
    const message={type:"projectDecision",action,projectId:view.projectId,revision:view.revision,...extra};
    if(action==="viewComparison"){const item=view.records.find(item=>item.record.id===extra.decisionId);if(!item)return;pendingDecisionComparison={projectId:view.projectId,decisionId:item.record.id,comparisonId:item.record.choice.comparisonId};}
    else if(action!=="navigate")pendingDecisionAction={...message,projectId:view.projectId};
    vscode.postMessage(message);if(!["navigate","viewComparison"].includes(action))render();
  }
  function decisionRecordBody(item,key) {
    const record=item.record,body=el("div","decision-body");body.append(el("p","decision-rationale",record.rationale));
    if(item.reason)body.append(el("p","feature-caption",item.reason));
    const scope=record.choice?.scope,files=record.choice?.files || [];
    const evidence=el("div","decision-evidence");evidence.append(el("p","feature-caption",`${record.feature?.title || "Feature unavailable"}${scope?.screen?.title?" · "+scope.screen.title:""}${scope?.scenario?.title?" · "+scope.scenario.title:""}`));
    for(const file of files){const link=button(file.path,()=>decisionAction("navigate",{decisionId:record.id,path:file.path}),"file-link","source");link.dataset.artifactFocus=key+"/source/"+file.path;link.title="Open current source";evidence.append(link,el("code","decision-source-hash",`Adopted ${file.afterHash}`));}
    evidence.append(el("p","artifact-boundary","Comparison evidence describes isolated copies before adoption. It does not verify the adopted source."),el("p","feature-caption","Adopted source · Compilation not recorded · Interaction not verified · Visual review not assessed"));
    const choice=record.choice;
    if(choice?.recipe?.title)evidence.append(el("p","feature-caption",`Recipe · ${choice.recipe.title}`));
    if(choice?.requested)evidence.append(el("p","feature-caption",matrixConditionLabel(choice.requested)+` · ${choice.requested.viewportHeightCss} px height`));
    for(const retained of choice?.evidence || []){const summary=el("section","decision-run");summary.append(el("strong","",retained.variant==="baseline"?"Baseline copy":"Chosen copy"));const run=retained.run;if(run){summary.append(el("p","feature-caption",`${run.observationCount} observations · ${run.requestCount} requests${run.unattributedRequestCount?` · ${run.unattributedRequestCount} unattributed`:""}`),el("p","feature-caption",`Interaction · ${run.assessment==="matched"?"Recorded as matched":run.assessment==="not-matched"?"Recorded as not matched":"Not assessed"}${run.truncated?" · Incomplete observation":""}`));}summary.append(el("p","feature-caption",`Recipe replay · ${retained.replay?.status==="completed"?"Completed":"Not retained"} · Capture ${retained.capture?"retained":"not retained"}`));evidence.append(summary);}
    const comparison=button("View retained comparison",()=>decisionAction("viewComparison",{decisionId:record.id}),"button small");comparison.dataset.artifactFocus=key+"/comparison";comparison.disabled=item.status?.evidence!=="available";evidence.append(comparison);
    body.append(contentDetails("Scope and evidence",key+"/evidence",[evidence]));
    const exact=el("pre","decision-json");exact.textContent=JSON.stringify({decision:record,digest:item.digest},null,2);body.append(contentDetails("Exact saved record",key+"/record",[exact]));return body;
  }
  function decisionRecords(items,key) {
    const list=el("div","decision-list");for(const item of items){const record=item.record,label=decisionStatus(item),details=lazyContentDetails(record.title,key+"/"+record.id,()=>[decisionRecordBody(item,key+"/"+record.id)],"content-details decision-record");details.dataset.decisionId=record.id;details.dataset.decisionStatus=label;const summary=details.firstElementChild;summary.replaceChildren(icon("chevron",12),el("span","decision-title",record.title),badge(label,label==="Current"?"source":"unknown"));list.append(details);}return list;
  }
  function decisionsForScope(kind,value) {
    const view=decisionView();if(!view)return null;
    const items=view.records.filter(item=>kind==="feature"?item.record.feature?.id===value:item.record.choice?.files?.some(file=>file.path===value));
    if(!items.length)return null;return contentDetails(`Decisions · ${items.length}`,`decisions/${kind}/${value}`,[decisionRecords(items,`decisions/${kind}/${value}`)],"content-details scoped-decisions");
  }
  function decisionForm(candidate) {
    const draft=decisionDraft(candidate),key="decisions/record/"+candidate.id+"/"+candidate.digest,form=el("form","decision-form");form.setAttribute("aria-label","Record project decision");
    const titleLabel=el("label","feature-field","Title"),title=el("input");title.setAttribute("aria-label","Decision title");title.maxLength=120;title.value=draft.title;title.dataset.designFocus=key+"/title";titleLabel.append(title);
    const rationaleLabel=el("label","feature-field","Why this choice"),rationale=el("textarea");rationale.setAttribute("aria-label","Decision rationale");rationale.maxLength=2000;rationale.rows=3;rationale.value=draft.rationale;rationale.dataset.designFocus=key+"/rationale";rationaleLabel.append(rationale);form.append(titleLabel,rationaleLabel);
    const view=decisionView(),choices=view.records.filter(item=>!item.status?.supersededBy&&item.record.feature?.id===candidate.feature.id);
    if(choices.length || draft.supersedesId){const label=el("label","feature-field","Replaces an earlier decision"),select=el("select");select.setAttribute("aria-label","Supersedes decision");select.dataset.designFocus=key+"/supersedes";const none=el("option","","None");none.value="";select.append(none);for(const item of choices){const option=el("option","",item.record.title);option.value=item.record.id;select.append(option);}if(draft.supersedesId&&!choices.some(item=>item.record.id===draft.supersedesId)){const missing=el("option","","Earlier decision unavailable");missing.value=draft.supersedesId;select.append(missing);}select.value=draft.supersedesId || "";select.addEventListener("change",()=>{draft.supersedesId=select.value || null;saveDecisionDraft(draft);refresh();});label.append(select);form.append(label);}
    const facts=el("div","decision-evidence");facts.append(el("p","feature-caption",candidate.feature.title));for(const file of candidate.files)facts.append(el("p","feature-caption",file.path));facts.append(el("p","artifact-boundary","Records your reason, the applied source hashes and the retained comparison. Comparison evidence comes from isolated copies; adopted-source verification is not recorded."));const exact=el("pre","decision-json");exact.textContent=JSON.stringify({files:candidate.files,feature:candidate.feature,evidence:candidate.evidence},null,2);facts.append(exact);form.append(contentDetails("Scope and evidence",key+"/scope",[facts]));
    const feedback=el("p","feature-caption");feedback.setAttribute("role","status");const submit=button("Record decision",()=>{},"button primary");submit.type="submit";submit.dataset.artifactFocus=key+"/submit";const refresh=()=>{const current=decisionView(),same=current?.candidate?.id===candidate.id&&current?.candidate?.digest===candidate.digest,unavailable=draft.supersedesId&&!current?.records.some(item=>item.record.id===draft.supersedesId&&!item.status?.supersededBy);submit.disabled=!same || !current.candidate.canRecord || current.storage?.status!=="saved" || Boolean(current.busy || pendingDecisionAction) || !draft.title.trim() || !draft.rationale.trim() || Boolean(unavailable);feedback.textContent=pendingDecisionAction?.action==="record"?"Recording decision…":unavailable?"Choose an available earlier decision, or None.":current?.candidate?.reason || "Saved locally. Shared with AI only when you select it in Context.";};
    for(const [input,field] of [[title,"title"],[rationale,"rationale"]])input.addEventListener("input",()=>{draft[field]=input.value;saveDecisionDraft(draft);refresh();});
    form.addEventListener("submit",event=>{event.preventDefault();refresh();if(!submit.disabled)decisionAction("record",{candidateId:candidate.id,candidateDigest:candidate.digest,title:draft.title.trim(),rationale:draft.rationale.trim(),...(draft.supersedesId?{supersedesId:draft.supersedesId}:{})});});const actions=el("div","feature-form-actions");actions.append(submit);form.append(feedback,actions);refresh();return form;
  }
  function projectDecisions() {
    const view=decisionView();if(!view || !view.candidate&&!view.records.length&&!view.error&&!["error","unavailable"].includes(view.storage?.status))return null;
    const section=el("section","surface project-decisions");section.setAttribute("aria-label","Project decisions");section.append(sectionHeading("Decisions",view.records.length));
    if(view.error || ["error","unavailable"].includes(view.storage?.status)){const message=el("p","feature-caption",view.error || view.storage.message || "Decision storage is unavailable. History is preserved.");message.setAttribute("role","status");section.append(message);const retry=button("Retry decision storage",()=>decisionAction("retry"),"button small");retry.disabled=Boolean(view.busy || pendingDecisionAction);section.append(retry);}
    if(view.candidate){if(view.candidate.canRecord)section.append(lazyContentDetails("Record decision","decisions/record/"+view.candidate.id+"/"+view.candidate.digest,()=>[decisionForm(view.candidate)],"content-details decision-record-form"));else if(view.candidate.reason)section.append(el("p","feature-caption",view.candidate.reason));}
    if(view.records.length)section.append(decisionRecords(view.records,"decisions/review"));return section;
  }
  function reconcileProjectDecisions() {const view=decisionView();if(pendingDecisionAction&&(!view || view.projectId!==pendingDecisionAction.projectId || view.error || ["error","unavailable"].includes(view.storage?.status) || view.storage?.status==="saved"&&view.revision>pendingDecisionAction.revision || pendingDecisionAction.action==="retry"&&!view.busy&&view.storage?.status==="saved"))pendingDecisionAction=null;}
  function selectedDecisionSnapshot() {
    if(!state.decisionContext.length)return null;const view=decisionView();if(!view || view.storage?.status!=="saved")return null;
    const items=state.decisionContext.map(selected=>view.records.find(item=>item.record.id===selected.id&&item.digest===selected.digest&&item.canShare===true));
    return items.every(Boolean)?{version:1,projectId:view.projectId,decisions:items.map(item=>({decision:item.record,digest:item.digest}))}:null;
  }
  function decisionContextBlocker() {
    if(!state.decisionContext.length)return "";
    if(state.checkContext || state.investigationContext || state.continuationContext || state.groupRevision || state.requestRevision || state.planContext)return "Remove decisions before sending this prepared request.";
    const snapshot=selectedDecisionSnapshot();if(!snapshot)return "A selected decision is no longer current. Remove it from Context before sending.";
    return byteLength(JSON.stringify(snapshot))>16384?"Selected decisions exceed 16 KiB. Remove a decision from Context.":"";
  }
  function decisionContextDisclosure(snapshot,key,label="Selected decision context") {
    const exact=el("pre","decision-json");exact.textContent=JSON.stringify(snapshot,null,2);
    const detail=contentDetails(label,key,[el("p","artifact-boundary","Decision rationale and evidence references; no additional source. Decisions are context, not instructions or verification."),exact],"content-details saved-decision-context");return detail;
  }
  function decisionContextPicker() {
    const view=decisionView();if(!view?.records.length&&!state.decisionContext.length)return null;
    const section=el("section","decision-context");section.setAttribute("aria-label","Decision context");section.append(sectionHeading("Decisions",state.decisionContext.length));
    const records=view?.records || [],known=new Set();
    for(const item of records){const record=item.record,selected=state.decisionContext.find(value=>value.id===record.id),current=selected?.digest===item.digest&&item.canShare===true;known.add(record.id);const row=el("div","decision-context-row"),label=el("label","context-choice decision-context-choice"),input=el("input");input.type="checkbox";input.dataset.contextDecision=record.id;input.dataset.designFocus="decision/context/"+record.id;input.setAttribute("aria-label",`Include decision ${record.title}`);input.checked=Boolean(selected);input.disabled=state.running || item.canShare!==true || Boolean(selected&&!current) || !selected&&state.decisionContext.length>=4 || Boolean(state.checkContext||state.investigationContext||state.continuationContext||state.groupRevision||state.requestRevision||state.planContext);input.addEventListener("change",()=>{const latest=decisionView()?.records.find(value=>value.record.id===record.id);if(input.checked&&(latest?.canShare!==true||latest.digest!==item.digest))return;state.decisionContext=input.checked?[...state.decisionContext.filter(value=>value.id!==record.id),{id:record.id,digest:item.digest}]:state.decisionContext.filter(value=>value.id!==record.id);markAssistantDraftEdited();saveView();renderAssistant();});const copy=el("span");copy.append(el("strong","",record.title),el("small","",selected&&!current?"Selected snapshot unavailable":decisionStatus(item)));label.append(input,copy);row.append(label);if(selected&&!current){const remove=button("Remove",()=>{state.decisionContext=state.decisionContext.filter(value=>value.id!==record.id);markAssistantDraftEdited();saveView();renderAssistant();},"button small");remove.setAttribute("aria-label",`Remove decision ${record.title}`);remove.disabled=state.running;row.append(remove);}section.append(row);}
    for(const selected of state.decisionContext.filter(value=>!known.has(value.id))){const row=el("div","decision-context-row");row.append(el("p","feature-caption","Selected decision unavailable"));const remove=button("Remove",()=>{state.decisionContext=state.decisionContext.filter(value=>value.id!==selected.id);markAssistantDraftEdited();saveView();renderAssistant();},"button small");remove.setAttribute("aria-label",`Remove unavailable decision ${selected.id}`);remove.disabled=state.running;row.append(remove);section.append(row);}
    if(decisionContextBlocker())section.append(el("p","context-guidance warning",decisionContextBlocker()));return section;
  }
  function savedDecisionContext(turn) {return turn.decisionContext?.version===1&&Array.isArray(turn.decisionContext.decisions)?decisionContextDisclosure(turn.decisionContext,`request/${turn.requestId}/decisions`,"Saved decision context"):null;}

  // Issues preserve a reported problem and its original observation. Source
  // freshness is a separate fact, not a reason to erase historical evidence.
  function issueView() {
    const view=state.reproducibleIssues;
    return state.trusted && view?.schemaVersion===1 && view.projectId===state.project?.id && Number.isSafeInteger(view.revision) && Array.isArray(view.records) && Array.isArray(view.candidates)?view:null;
  }
  function issueStatus(item) {
    const status=item?.status;if(!status)return "Unavailable";
    if(status.source==="missing" || status.captureSource==="missing" || [status.run,status.replay,status.capture].includes("missing"))return "Evidence unavailable";
    if(status.source==="stale" || status.captureSource==="stale" || [status.run,status.replay,status.capture].includes("changed"))return "Historical";
    return "Current source";
  }
  function validIssueSelections(value) {return Array.isArray(value)&&value.length<=1&&value.every(item=>item&&Object.keys(item).every(key=>["id","digest"].includes(key))&&validAssistantIdentity(item.id)&&/^[a-f0-9]{64}$/.test(item.digest || ""));}
  function safeIssueDraft(value) {return value&&validAssistantIdentity(value.projectId)&&validAssistantIdentity(value.runId)&&/^[a-f0-9]{64}$/.test(value.runDigest || "")&&typeof value.title==="string"&&value.title.length<=120&&typeof value.actualOutcome==="string"&&value.actualOutcome.length<=2000?{projectId:value.projectId,runId:value.runId,runDigest:value.runDigest,title:value.title,actualOutcome:value.actualOutcome}:null;}
  function issueDraftKey(value) {return JSON.stringify([value.projectId,value.runId,value.runDigest]);}
  function issueDraft(candidate,run) {const blank={projectId:state.project.id,runId:candidate.id,runDigest:candidate.digest,title:candidate.title.slice(0,120),actualOutcome:run.note || ""},key=issueDraftKey(blank);if(!issueDrafts.has(key))issueDrafts.set(key,blank);return issueDrafts.get(key);}
  function saveIssueDraft(draft) {const key=issueDraftKey(draft);issueDrafts.delete(key);issueDrafts.set(key,draft);while(issueDrafts.size>16)issueDrafts.delete(issueDrafts.keys().next().value);saveView();}
  function issueAction(action,extra={}) {
    const view=issueView();if(!view || view.busy || pendingIssueAction)return;
    if(action==="record" && (view.storage?.status!=="saved" || !view.candidates.some(item=>item.id===extra.runId&&item.digest===extra.runDigest&&item.canRecord===true)))return;
    const message={type:"reproducibleIssue",projectId:view.projectId,revision:view.revision,action,...extra};
    if(action==="viewEvidence"){const item=view.records.find(value=>value.record.id===extra.issueId);if(!item)return;pendingIssueEvidence={projectId:view.projectId,issueId:item.record.id,runId:item.record.run.id};}
    else if(action!=="navigate")pendingIssueAction={...message};
    vscode.postMessage(message);if(!["navigate","viewEvidence"].includes(action))render();
  }
  function issueCaptureForm(run) {
    const candidate=issueView()?.candidates.find(value=>value.id===run.id);if(!candidate)return null;
    if(!candidate.canRecord)return candidate.reason?el("p","feature-caption",candidate.reason):null;
    const key=`issues/capture/${run.id}/${candidate.digest}`;
    return lazyContentDetails("Capture issue",key,()=>{
      const draft=issueDraft(candidate,run),form=el("form","issue-form");form.setAttribute("aria-label","Capture reproducible issue");
      const titleLabel=el("label","feature-field","Title"),title=el("input");title.setAttribute("aria-label","Issue title");title.maxLength=120;title.value=draft.title;title.dataset.designFocus=key+"/title";titleLabel.append(title);
      const outcomeLabel=el("label","feature-field","What happened"),outcome=el("textarea");outcome.setAttribute("aria-label","Actual outcome");outcome.maxLength=2000;outcome.rows=3;outcome.value=draft.actualOutcome;outcome.dataset.designFocus=key+"/outcome";outcomeLabel.append(outcome);form.append(titleLabel,outcomeLabel);
      const steps=el("ol","scenario-steps");for(const step of run.scenario.steps)steps.append(el("li","",step));form.append(contentDetails("Steps and expected result",key+"/steps",[steps,el("p","scenario-expected-label","Expected result"),el("p","scenario-expected",run.scenario.expectedOutcome),el("p","feature-caption","Copied from this recorded scenario. Capturing an issue does not repeat the interaction.")]));
      const feedback=el("p","feature-caption");feedback.setAttribute("role","status");const submit=button("Save issue",()=>{},"button primary");submit.type="submit";submit.dataset.artifactFocus=key+"/submit";
      const refresh=()=>{const view=issueView(),current=view?.candidates.find(value=>value.id===candidate.id&&value.digest===candidate.digest);submit.disabled=!current?.canRecord || view.storage?.status!=="saved" || Boolean(view.busy || pendingIssueAction) || !draft.title.trim() || !draft.actualOutcome.trim();feedback.textContent=pendingIssueAction?.action==="record"?"Saving issue…":current?.reason || "Saved on this device. AI receives it only when selected in Context.";};
      for(const [input,field] of [[title,"title"],[outcome,"actualOutcome"]])input.addEventListener("input",()=>{draft[field]=input.value;saveIssueDraft(draft);refresh();});
      form.addEventListener("submit",event=>{event.preventDefault();refresh();if(!submit.disabled)issueAction("record",{runId:candidate.id,runDigest:candidate.digest,title:draft.title.trim(),actualOutcome:draft.actualOutcome.trim()});});const actions=el("div","feature-form-actions");actions.append(submit);form.append(feedback,actions);refresh();return [form];
    },"content-details issue-capture-form");
  }
  function issueRecordBody(item,key) {
    const record=item.record,run=record.run,body=el("div","issue-body");body.append(el("p","scenario-expected-label","Reported outcome"),el("p","issue-outcome",record.actualOutcome));
    if(item.reason)body.append(el("p","feature-caption",item.reason));
    body.append(el("p","feature-caption",`${run.feature.title} · ${run.screen.title} · ${run.scenario.title}`));
    const steps=el("ol","scenario-steps");for(const step of record.reproduction.steps)steps.append(el("li","",step));body.append(contentDetails("Steps and expected result",key+"/steps",[steps,el("p","scenario-expected-label","Expected result"),el("p","scenario-expected",record.reproduction.expectedOutcome),el("p","feature-caption","Scenario instructions recorded with the observation; reproducibility has not been independently verified.")]));
    const evidence=el("div","issue-evidence"),count=run.observations.length;evidence.append(el("p","feature-caption",`${savedObservationStatus(run)} · ${formatHistoryTime(run.endedAt)} · ${count} ${count===1?"request":"requests"}`),el("p","artifact-boundary","Requests were observed during this interval. Their relationship to the steps is unconfirmed; request bodies and headers are excluded."));
    for(const request of run.observations)evidence.append(comparisonRequestDetails(request,`${key}/request/${request.id}`));
    if(!count)evidence.append(el("p","feature-caption","No requests were captured during this observation."));if(run.truncated)evidence.append(el("p","feature-caption warning","Observation limit reached. Request evidence is incomplete."));if(run.interruption)evidence.append(el("p","feature-caption warning",run.interruption));
    const status=item.status || {};if(status.source==="missing" || status.captureSource==="missing")body.append(el("p","feature-caption","Source unavailable or not checked. Refresh to update availability."));evidence.append(el("p","feature-caption",`Original observation · ${status.run || "unknown"}`),el("p","feature-caption",`Recipe replay · ${record.replay?record.replay.replay.status+" · "+(status.replay || "unknown"):"Not attached"}`),el("p","feature-caption",`Capture metadata · ${record.capture?(status.capture || "unknown"):"Not attached"}`));
    if(record.capture)evidence.append(el("p","feature-caption","Image bytes are verified only when you explicitly view the capture."),el("code","issue-source-hash",`PNG ${record.capture.capture.image.sha256}`));
    const view=button("View original observation",()=>issueAction("viewEvidence",{issueId:record.id}),"button small");view.dataset.artifactFocus=key+"/evidence/view";view.disabled=status.run!=="available" || run.feature.id!==activeFeature()?.id;evidence.append(view);if(run.feature.id!==activeFeature()?.id)evidence.append(el("p","feature-caption","Select this issue’s feature to view its original observation."));body.append(contentDetails("Observed evidence",key+"/evidence",[evidence]));
    const source=el("div","issue-evidence");source.append(el("p","feature-caption",`Observation source · ${status.source || "unknown"} · Source at issue capture · ${status.captureSource || "unknown"}`));
    for(const file of run.sources){const link=button(file.path,()=>issueAction("navigate",{issueId:record.id,path:file.path}),"file-link","source");link.dataset.artifactFocus=key+"/source/"+file.path;link.title="Open current saved source";source.append(link,el("code","issue-source-hash",`Observed revision ${file.revision}`));const atCapture=record.contextFiles.find(value=>value.path===file.path);if(atCapture)source.append(el("code","issue-source-hash",`Issue capture revision ${atCapture.hash}`));}
    if(run.dirtyPaths.length)source.append(el("p","feature-caption",`Unsaved drafts excluded: ${run.dirtyPaths.join(", ")}`));source.append(el("p","artifact-boundary","Runtime-to-source relationship unverified. Compilation not recorded; no automatic behavioral or visual verdict."));body.append(contentDetails("Source and provenance",key+"/source",[source]));
    const exact=el("pre","issue-json");exact.textContent=JSON.stringify({issue:record,digest:item.digest,assessment:item.status},null,2);body.append(contentDetails("Exact saved record",key+"/record",[exact]));return body;
  }
  function issueRecords(items,key) {const list=el("div","issue-list");for(const item of items){const record=item.record,label=issueStatus(item),details=lazyContentDetails(record.title,key+"/"+record.id,()=>[issueRecordBody(item,key+"/"+record.id)],"content-details issue-record");details.dataset.issueId=record.id;details.dataset.issueStatus=label;details.firstElementChild.replaceChildren(icon("chevron",12),el("span","issue-title",record.title),badge(label,label==="Current source"?"source":"unknown"));list.append(details);}return list;}
  function issuesForScope(kind,value) {const view=issueView();if(!view)return null;const items=view.records.filter(item=>kind==="feature"?item.record.run.feature.id===value:item.record.run.sources.some(file=>file.path===value));return items.length?contentDetails(`Issues · ${items.length}`,`issues/${kind}/${value}`,[issueRecords(items,`issues/${kind}/${value}`)],"content-details scoped-issues"):null;}
  function reproducibleIssues() {
    const view=issueView();if(!view || !view.records.length&&!view.error&&!["error","unavailable"].includes(view.storage?.status))return null;
    const section=el("section","surface reproducible-issues");section.setAttribute("aria-label","Reproducible issues");section.append(sectionHeading("Issues",view.records.length));
    if(view.error || ["error","unavailable"].includes(view.storage?.status)){const notice=el("p","feature-caption",view.error || view.storage.message || "Issue storage is unavailable. History is preserved.");notice.setAttribute("role","status");section.append(notice);const retry=button("Retry issue storage",()=>issueAction("retry"),"button small");retry.disabled=Boolean(view.busy || pendingIssueAction);retry.dataset.artifactFocus="issues/retry";section.append(retry);}
    if(view.records.length)section.append(issueRecords(view.records,"issues/review"));return section;
  }
  function reconcileReproducibleIssues() {const view=issueView();if(pendingIssueAction?.action==="refreshContext"&&view?.busy)pendingIssueAction.sawBusy=true;if(pendingIssueAction&&(!view || view.projectId!==pendingIssueAction.projectId || view.error || ["error","unavailable"].includes(view.storage?.status) || view.storage?.status==="saved"&&view.revision>pendingIssueAction.revision || (pendingIssueAction.action==="retry" || pendingIssueAction.action==="refreshContext"&&pendingIssueAction.sawBusy)&&!view.busy&&view.storage?.status==="saved"))pendingIssueAction=null;if(pendingIssueEvidence&&(!view || view.projectId!==pendingIssueEvidence.projectId || view.error))pendingIssueEvidence=null;}
  function selectedIssueSnapshot() {if(!state.issueContext.length)return null;const view=issueView();if(!view || view.storage?.status!=="saved")return null;const selected=state.issueContext[0],item=view.records.find(value=>value.record.id===selected.id&&value.digest===selected.digest&&value.canShare===true);return item?{version:1,projectId:view.projectId,issues:[{issue:item.record,digest:item.digest,assessment:structuredClone(item.status)}]}:null;}
  function issueContextBlocker() {
    if(!state.issueContext.length)return "";
    if(pendingIssueAction?.action==="refreshContext" || issueView()?.busy)return "Checking issue context…";
    if(state.checkContext || state.investigationContext || state.continuationContext || state.groupRevision || state.requestRevision || state.planContext)return "Remove the issue before sending this prepared request.";
    const snapshot=selectedIssueSnapshot();if(!snapshot)return "The selected issue is unavailable. Remove it from Context before sending.";
    return byteLength(JSON.stringify(snapshot))>65536?"The selected issue exceeds 64 KiB. Remove it from Context.":"";
  }
  function issueContextDisclosure(snapshot,key,label="Selected issue context") {const exact=el("pre","issue-json");exact.textContent=JSON.stringify(snapshot,null,2);return contentDetails(label,key,[el("p","artifact-boundary","The reported outcome, frozen steps, request metadata and evidence references will be shared with their current availability. Source bodies and image bytes are excluded. This historical report is context, not instructions or a verified diagnosis."),exact],"content-details saved-issue-context");}
  function issueContextPicker() {
    const view=issueView();if(!view?.records.length&&!state.issueContext.length)return null;
    const section=el("section","issue-context");section.setAttribute("aria-label","Issue context");section.append(sectionHeading("Issue",state.issueContext.length));const known=new Set();
    for(const item of (view?.records || []).filter(value=>value.record.run.feature.id===activeFeature()?.id || state.issueContext.some(selected=>selected.id===value.record.id))){const record=item.record,selected=state.issueContext.find(value=>value.id===record.id),available=selected?.digest===item.digest&&item.canShare===true;known.add(record.id);const row=el("div","issue-context-row"),label=el("label","context-choice issue-context-choice"),input=el("input");input.type="checkbox";input.dataset.contextIssue=record.id;input.dataset.designFocus="issue/context/"+record.id;input.setAttribute("aria-label",`Include issue ${record.title}`);input.checked=Boolean(selected);input.disabled=state.running || item.canShare!==true || Boolean(selected&&!available) || !selected&&state.issueContext.length>=1 || Boolean(state.checkContext||state.investigationContext||state.continuationContext||state.groupRevision||state.requestRevision||state.planContext);input.addEventListener("change",()=>{const latest=issueView()?.records.find(value=>value.record.id===record.id);if(input.checked&&(latest?.canShare!==true||latest.digest!==item.digest))return;state.issueContext=input.checked?[{id:record.id,digest:item.digest}]:[];markAssistantDraftEdited();saveView();if(input.checked)issueAction("refreshContext",{issueId:record.id,digest:item.digest});else renderAssistant();});const copy=el("span");copy.append(el("strong","",record.title),el("small","",selected&&!available?"Selected snapshot unavailable":item.reason || issueStatus(item)));label.append(input,copy);row.append(label);if(selected&&!available){const remove=button("Remove",()=>{state.issueContext=[];markAssistantDraftEdited();saveView();renderAssistant();},"button small");remove.setAttribute("aria-label",`Remove issue ${record.title}`);remove.disabled=state.running;row.append(remove);}section.append(row);}
    for(const selected of state.issueContext.filter(value=>!known.has(value.id))){const row=el("div","issue-context-row");row.append(el("p","feature-caption","Selected issue unavailable"));const remove=button("Remove",()=>{state.issueContext=[];markAssistantDraftEdited();saveView();renderAssistant();},"button small");remove.setAttribute("aria-label",`Remove unavailable issue ${selected.id}`);remove.disabled=state.running;row.append(remove);section.append(row);}
    if(state.issueContext.length){const selected=state.issueContext[0],item=view?.records.find(value=>value.record.id===selected.id&&value.digest===selected.digest),refresh=button("Refresh issue context",()=>issueAction("refreshContext",{issueId:selected.id,digest:selected.digest}),"button small");refresh.dataset.designFocus="issue/context/refresh";refresh.disabled=state.running || !item?.canShare || Boolean(view?.busy || pendingIssueAction);section.append(refresh);}
    if(issueContextBlocker())section.append(el("p","context-guidance warning",issueContextBlocker()));return section;
  }
  function savedIssueContext(turn) {return turn.issueContext?.version===1&&Array.isArray(turn.issueContext.issues)?issueContextDisclosure(turn.issueContext,`request/${turn.requestId}/issues`,"Saved issue context"):null;}

  function review() {
    const wrap = el("div", "review-page");
    const heading = el("div", "page-heading review-heading");
    heading.append(el("h1", "", "Review changes"), button("Open Source Control", () => action("foundation.openGit"), state.proposal ? "button" : "button primary", "branch"));
    wrap.append(heading);
    const group=state.changeSetSession?.current,groupStorage=changeSetStorageNotice();if(groupStorage)wrap.append(groupStorage);const unfinishedPlan=orphanCheckPlanNotice();if(unfinishedPlan)wrap.append(unfinishedPlan);
    if(group){wrap.append(changeSetArtifact(group,true));const comparison=alternativePanel(group,"change-set");if(comparison)wrap.append(comparison);}
    if (state.proposal) {
      if (["proposed", "stale", "applied"].includes(state.proposal.status)) wrap.append(proposalReview(state.proposal));
      else wrap.append(contentDetails(`Previous proposal · ${{discarded:"Discarded",undone:"Undone"}[state.proposal.status] || "Unavailable"}`, `review/${state.proposal.id}:previous`, [proposalReview(state.proposal)], "content-details previous-proposal"));
    }
    if (state.changes.length) {
      const list = el("section", "surface"); list.append(sectionHeading("Foundation changes", state.changes.length));
      for (const change of state.changes) {
        const b = button("", () => vscode.postMessage({ type: "reviewFile", path: change.path }), "change-row");
        b.append(icon("source", 16), el("span", "", change.path), badge(change.conflict ? "Changed on disk" : "Saved change", change.conflict ? "unknown" : "source"), icon("external", 13)); list.append(b);
      }
      wrap.append(list);
    } else if (!activeChangeSet() && (!state.proposal || !["proposed", "stale", "applied"].includes(state.proposal.status))) {
      const empty = el("div", "review-empty");
      const copy = el("div"); copy.append(el("h2", "", "No active Foundation changes"), el("p", "", "Check Source Control for other project changes."));
      empty.append(icon("review", 24), copy); wrap.append(empty);
    }
    const decisions=projectDecisions();if(decisions)wrap.append(decisions);
    const issues=reproducibleIssues();if(issues)wrap.append(issues);
    const alternatives=alternativeHistory();if(alternatives)wrap.append(alternatives);
    const linkedEvidence=visualVerificationHistory();if(linkedEvidence)wrap.append(linkedEvidence);
    const checks = el("section", "surface verification"); checks.append(sectionHeading("Checks"));
    for (const name of ["Preview compilation", "Interaction", "Visual review"]) {
      const row = el("div", "verification-row");
      const compilation = !group && name === "Preview compilation" && (state.proposal ? artifacts.verification(state.proposal, state.design).compilation : !state.design?.stale && state.design?.compilation);
      row.append(el("strong", "", name), badge(compilation === "passed" ? "Preview compiled" : compilation === "failed" ? "Preview failed" : "Not run", compilation === "passed" ? "source" : "unknown")); checks.append(row);
    }
    const explanation = [el("p", "", "Preview compilation checks supported modules, not the full project build. Interaction and visual review require separate verification in the intended states, themes, and sizes.")];
    if (!group && state.design?.observed && !state.design?.stale) explanation.push(el("p", "", "The preview rendered. Interaction and visual acceptance remain unverified."));
    checks.append(contentDetails("About these checks", "review/checks:about", explanation));
    const actions = el("div", "page-actions");
    actions.append(button("Open terminal", () => action("foundation.openTerminal"), "button", "terminal"), button("Run and Debug", () => action("foundation.openDebug"), "button", "debug"));
    checks.append(actions); wrap.append(checks); return wrap;
  }
  function contextPicker() {
    const files = sourceFiles();
    const picked = selectedFiles();
    const total = (state.checkContext?checkContextView().files:state.groupRevision?groupRevisionView().files:picked).reduce((n, file) => n + byteLength(file.source), 0);
    const section = el("section", "shared-context");
    const heading = sectionHeading(
      "Shared context",
      `${state.context.length} ${state.context.length === 1 ? "file" : "files"}`,
    );
    heading.append(el("span", "quiet", formatBytes(total)));
    section.append(heading);
    const taskCard=state.checkContext || state.investigationContext || state.continuationContext?null:featureTaskCard();if(taskCard)section.append(taskCard);
    if (!files.length)
      section.append(
        el(
          "p",
          "empty-copy",
          "Open a source file in the editor to add context.",
        ),
      );
    const unavailablePaths=unavailableContextPaths();
    for (const file of files) {
      if(unavailablePaths.includes(file.path))continue;
      const dirty = state.dirtyPaths.includes(file.path);
      const label = el("label", "context-choice");
      const input = el("input");
      input.type = "checkbox";
      input.dataset.contextPath = file.path;
      input.checked = state.context.includes(file.path);
      input.disabled = state.running || !input.checked && state.context.length>=32;
      input.addEventListener("change", () => {
        state.context = input.checked
          ? [...state.context.filter((path) => path !== file.path), file.path]
          : state.context.filter((path) => path !== file.path);
        state.contextInitialized=true;detachRequestRevision();markAssistantDraftEdited();
        if(assistantRestoreRequest)requestAssistantSources();
        saveView();renderAssistant();
      });
      const copy = el("span");
      copy.append(
        el("strong", "", basename(file.path)),
        el("small", "", file.path),
      );
      label.append(
        input,
        icon("source", 14),
        copy,
        el(
          "span",
          dirty ? "dirty-note" : "context-revision",
          dirty ? "Unsaved" : file.revision.slice(0, 7),
        ),
      );
      section.append(label);
    }
    for(const path of unavailablePaths) {
      const label=el("label","context-choice"),input=el("input");input.type="checkbox";input.checked=true;input.disabled=state.running;input.dataset.contextPath=path;input.setAttribute("aria-label",`Include ${path}`);
      input.addEventListener("change",()=>{state.context=state.context.filter(item=>item!==path);state.contextInitialized=true;state.contextUnavailable=state.contextUnavailable.filter(item=>item.path!==path);detachRequestRevision();markAssistantDraftEdited();if(assistantRestoreRequest)requestAssistantSources();saveView();renderAssistant();});
      const copy=el("span"),reason=state.contextUnavailable.find(item=>item.path===path)?.reason;
      copy.append(el("strong","",basename(path)),el("small","",path),el("small","",reason || (state.contextRestoreLoading || state.featureLoading ? "Loading saved source…" : "Source unavailable. Retry loading or remove it from context.")));
      label.append(input,icon("source",14),copy,el("span","dirty-note",reason?"Unavailable":state.contextRestoreLoading || state.featureLoading?"Loading":"Unavailable"));section.append(label);
    }
    if(unavailablePaths.length && !state.contextRestoreLoading)section.append(button("Retry saved context",()=>{requestAssistantSources();saveView();renderAssistant();},"button small","refresh"));
    const inspect = el("details", "context-inspect");
    inspect.open = state.sourceExpanded;
    inspect.addEventListener("toggle", () => {
      state.sourceExpanded = inspect.open;
    });
    const inspectSummary = el("summary", "", "Inspect exactly what will be shared");
    inspectSummary.dataset.artifactFocus = "context/inspect"; inspect.append(inspectSummary);
    if(state.featureTaskIncluded && activeFeature()) {
      const feature=activeFeature();inspect.append(el("strong","",feature.title),el("p","feature-brief",feature.brief),el("p","feature-caption",`Task context · feature revision ${state.features.revision}`));
    }
    if(state.intent==="build" && selectedPlanSnapshot()) {
      const plan=selectedPlanSnapshot(),block=el("div","context-source");block.append(el("strong","",`Plan · ${plan.title} · version ${plan.revision}`),el("p","",plan.summary),el("strong","",plan.step.title),el("p","",plan.step.detail));
      for(const ref of plan.step.references)block.append(el("code","",`${ref.sourceId} · ${ref.path}:${ref.line}–${ref.endLine} · ${ref.revision.slice(0,7)}`));if(plan.verification.length){block.append(el("strong","","Suggested checks · Not run"));const checks=el("ul");for(const item of plan.verification)checks.append(el("li","",item));block.append(checks);}inspect.append(block);
    }
    if(state.continuationContext)inspect.append(continuationDisclosure(state.continuationContext,"context/continuation"));
    if(state.investigationContext)inspect.append(sourceInvestigationEvidence(state.investigationContext,"context/investigation",false));
    if(state.checkContext)inspect.append(el("p","artifact-boundary","Shares staged source, saved support files, and supported check names. Earlier chat, tool output, configuration paths, task brief, and runtime observations are not included."));
    if(state.groupRevision)inspect.append(el("p","artifact-boundary","This request shares staged group source over the original saved basis. File choices describe the saved baseline; changing them removes the refinement."));
    for (const file of (state.checkContext?checkContextView().files:state.groupRevision?groupRevisionView().files:picked)) {
      const chunk = el("div", "context-source");
      chunk.append(
        el(
          "div",
          "context-source-path",
          `${file.path} · ${file.origin==="staged"?"Staged source":file.revision.slice(0, 7)}`,
        ),
      );
      const pre = el("pre");
      pre.textContent = file.source;
      chunk.append(pre);
      inspect.append(chunk);
    }
    if (state.runtime && !state.checkContext && !state.investigationContext && !state.continuationContext) {
      section.append(runtimeContextPicker());
      for (const item of selectedRuntimeEvidence()) inspect.append(observationDetails(item, `shared-runtime/${item.id}`));
    }
    if(window.FoundationKnowledge){const browse=button("Browse project knowledge",()=>action("foundation.knowledge"),"button small","search");browse.dataset.designFocus="knowledge/browse";section.append(browse);}
    const decisions=decisionContextPicker();if(decisions)section.append(decisions);
    const issues=issueContextPicker();if(issues)section.append(issues);
    const issueSnapshot=selectedIssueSnapshot();if(issueSnapshot)inspect.append(issueContextDisclosure(issueSnapshot,"context/issues"));
    const decisionSnapshot=selectedDecisionSnapshot();if(decisionSnapshot)inspect.append(decisionContextDisclosure(decisionSnapshot,"context/decisions"));
    section.append(inspect);
    section.append(contentDetails("Privacy and history", "context/privacy", [el("p", "", state.continuationContext?"This request shares the disclosed investigation goal, one previous explanation, current relationship result, available targets and attempt budget, plus the selected saved file. Other chat, runtime observations, task briefs, tool output and related file contents stay local.":state.investigationContext?"This request sends your prompt, the saved anchor source and the disclosed relationship evidence. Related file contents, previous chat, task briefs, runtime observations and tool output are not sent. Investigation identities and source manifests stay local.":state.checkContext?"This request sends your prompt, the disclosed staged source and saved support files, and supported check names. Earlier chat, tool output, configuration paths, task brief, and runtime observations are not sent.":state.groupRevision?"This request sends your prompt, the disclosed staged source and saved support files. Previous chat and tool output are not sent. The original saved basis and group identity are retained locally.":state.conversations
      ? "Each request sends your prompt, selected saved source, checked runtime observations, selected decisions, and the task brief only when included. Previous turns are not sent automatically. Prompts, replies, and source snapshots are stored locally for this project."
      : "Each request sends your prompt, selected saved source, checked runtime observations, selected decisions, and the task brief only when included. Previous turns are not sent automatically. This reference keeps artifacts for the current panel session.")]));
    const warning = picked.some((file) => state.dirtyPaths.includes(file.path))
      ? "Save the selected files before asking. Unsaved editor buffers are never silently shared."
      : picked.length > 8
        ? "Select up to eight files."
        : total > 65536
          ? "Selected source exceeds 64 KiB. Remove a file from context."
          : "";
    if (warning) section.append(
      el(
        "p",
        picked.some((file) => state.dirtyPaths.includes(file.path)) ||
          picked.length > 8 ||
          total > 65536
          ? "context-guidance warning"
          : "context-guidance",
        warning,
      ),
    );
    return section;
  }
  const answerRenderBasis = new WeakMap();
  function answerText(turn) {
    const text = el("div", "answer-text");
    answerRenderBasis.set(text, {answer:turn.answer,
      citations:JSON.stringify(turn.context.map(({id,path,revision,lines})=>({id,path,revision,lines}))),
      runtime:JSON.stringify(turn.runtimeEvidence || [])});
    const pattern = /\[(?:(S\d+):(\d+)|(R\d+))\]/g;
    let offset = 0;
    for (const match of turn.answer.matchAll(pattern)) {
      text.append(
        document.createTextNode(turn.answer.slice(offset, match.index)),
      );
      if (match[3]) {
        const observation=turn.runtimeEvidence?.find(item=>item.id===match[3]);
        if(observation){
          const citation=button(`Request ${match[3].slice(1)}`,()=>{
            const content=citation.closest(".artifact-content");const history=content?.querySelector(".saved-runtime-evidence");
            const record=history?.querySelector(`[data-runtime-evidence="${CSS.escape(observation.id)}"]`);
            if(history)history.open=true;if(record){record.open=true;record.querySelector("summary")?.focus();record.scrollIntoView({block:"nearest"});}
          },"citation");
          citation.dataset.artifactFocus=`request/${turn.requestId}:citation:${match.index}`;citation.title=`${observationLabel(observation)} · ${observationOutcome(observation)} · saved observation`;text.append(citation);
        }else text.append(document.createTextNode(match[0]));
        offset=match.index+match[0].length;continue;
      }
      const source = turn.context.find((item) => item.id === match[1]);
      const line = Number(match[2]);
      if (source && line >= 1 && line <= source.lines) {
        const citation = button(
          `${basename(source.path)}:${line}`,
          () => navigate(source.path, line),
          "citation",
        );
        citation.dataset.artifactFocus = `request/${turn.requestId}:citation:${match.index}`;
        citation.title = `${source.path}:${line} · answer source ${source.revision.slice(0, 7)}; opens current source`;
        text.append(citation);
      } else text.append(document.createTextNode(match[0]));
      offset = match.index + match[0].length;
    }
    text.append(document.createTextNode(turn.answer.slice(offset)));
    return text;
  }
  const artifacts = window.FoundationArtifacts;
  const artifactCollapsed = new Map();
  const disclosureState = new Map();
  let artifactDialog = null;
  let expandedArtifact = null;
  let artifactReturnFocus = null;
  function artifactButton(label, handler, key, primary = false, glyph) {
    const control = button(label, handler, primary ? "button primary" : "button", glyph);
    control.dataset.artifactFocus = key;
    return control;
  }
  function artifactCard({id, kind, title, status, scope, provenance, freshness, body, actions = [], warnings = [], expanded = false, open}) {
    const card = el("section", "ai-work-artifact");
    card.dataset.artifactId = id;
    card.dataset.artifactKind = kind;
    card.setAttribute("aria-label", `${kind}: ${title}`);
    const heading = el("header", "artifact-heading");
    const copy = el("div", "artifact-heading-copy");
    if (kind !== "Explanation") copy.append(el("span", "artifact-kind", kind));
    copy.append(el("h2", "", title));
    if (expanded) heading.append(copy);
    else {
      const toggle = artifactButton("", () => {
        artifactCollapsed.set(id, !artifactCollapsed.get(id));
        renderAssistant();
      }, `${id}:toggle`);
      toggle.className = "artifact-toggle";
      toggle.append(icon(kind === "Code changes" ? "review" : kind === "Verification" ? "shield" : "source"), copy, icon("chevron", 12));
      toggle.setAttribute("aria-label", `${artifactCollapsed.get(id) ? "Expand" : "Collapse"} ${kind}`);
      toggle.setAttribute("aria-expanded", String(!artifactCollapsed.get(id)));
      heading.append(toggle);
      if (open) {
        const expand = artifactButton("", open, `${id}:open`, false, "external");
        expand.className = "icon-button artifact-expand";
        expand.setAttribute("aria-label", `Open ${kind} details`);
        heading.append(expand);
      }
    }
    const meta = el("div", "artifact-metadata");
    meta.append(el("span", "artifact-status", status));
    if (scope) meta.append(el("span", "artifact-scope", scope));
    const evidence = el("div", "artifact-evidence");
    evidence.append(el("span", "", provenance));
    if (freshness) evidence.append(el("span", freshness === "Stale" ? "warning" : "", freshness));
    card.append(heading, meta, evidence);
    for (const warning of warnings.filter(Boolean)) card.append(note(warning, "warning"));
    const content = el("div", "artifact-content");
    content.hidden = !expanded && artifactCollapsed.get(id) === true;
    content.append(body);
    card.append(content);
    if (actions.length) { const footer = el("footer", "artifact-actions"); footer.append(...actions); card.append(footer); }
    if (expanded) card.append(contentDetails("Artifact identity", `${id}:identity`, [el("code", "artifact-identity", id)], "content-details artifact-details"));
    return card;
  }
  function sourceSnapshots(context, id, open = false, label = "Saved source") {
    const details = el("details", "answer-sources");
    details.open = disclosureState.has(id) ? disclosureState.get(id) === true : open;
    details.addEventListener("toggle", () => disclosureState.set(id, details.open));
    const summary = el("summary", "", `${label} · ${context.length} ${context.length === 1 ? "file" : "files"}`);
    summary.dataset.artifactFocus = id;
    details.append(summary);
    for (const source of context) {
      const block = el("div", "context-source");
      block.append(el("div", "context-source-path", `${source.id || "Source"} · ${source.path} · ${source.revision.slice(0, 7)}`), el("pre", "", source.source || ""));
      details.append(block);
    }
    return details;
  }
  function activeConversation() {
    return state.conversations?.conversations.find(item => item.id === state.conversations.activeId) || null;
  }
  function currentProposalId() {
    return activeConversation()?.archived || (state.proposal?.status==="proposed" && activeChangeSet() || state.proposal?.status==="applied" && ["applied","recovery-required"].includes(activeChangeSet()?.status)) ? null : state.proposal?.id || null;
  }
  function currentProposal(id) {
    return state.proposal?.id === id ? state.proposal : state.turns.find(turn => turn.proposal?.id === id)?.proposal;
  }
  function verificationArtifact(proposal, expanded = false, embedded = false) {
    const status = artifacts.verification(proposal, state.design);
    const body = el("div", "artifact-checks");
    for (const [label, outcome] of [["Preview compilation", status.compilation], ["Interaction", status.interaction], ["Visual review", status.visual]]) {
      const row = el("div", "artifact-check");
      row.append(el("span", "", label), el("strong", outcome === "passed" ? "success" : outcome === "failed" ? "warning" : "", outcome === "passed" ? "Passed" : outcome === "failed" ? "Failed" : "Not run"));
      body.append(row);
    }
    body.append(el("p", "artifact-boundary", status.detail));
    if (status.connected) body.append(el("p", "artifact-boundary", "This preview rendered. Interaction and visual acceptance remain unverified."));
    const history = artifacts.verificationHistory(proposal, state.turns);
    if (history.length) {
      const records = el("details", "verification-history");
      const historyKey = `proposal/${proposal.id}/verification:history`;
      records.open = disclosureState.has(historyKey) ? disclosureState.get(historyKey) === true : expanded;
      records.addEventListener("toggle", () => disclosureState.set(historyKey, records.open));
      const summary = el("summary", "", `Saved verification history · ${history.length}`);
      summary.dataset.artifactFocus = historyKey;
      records.append(summary);
      records.append(el("p", "artifact-boundary", "Historical results only. Current source and preview are not verified by these records."));
      for (const record of history.slice().reverse()) {
        const item = el("article", "verification-record");
        item.append(el("strong", "", `Compilation ${record.compilation === "not-run" ? "not run" : record.compilation}`));
        item.append(el("time", "", formatHistoryTime(record.recordedAt)), el("code", "", `Source ${record.revision.slice(0, 7)}`));
        item.append(el("p", "", `Interaction: not run · Visual review: not run${record.observed ? " · Preview rendered then" : ""}`));
        const identity = el("details", "verification-identity");
        const identityKey = `proposal/${proposal.id}/verification:${record.id}:identity`;
        identity.open = disclosureState.get(identityKey) === true;
        identity.addEventListener("toggle", () => disclosureState.set(identityKey, identity.open));
        const identitySummary = el("summary", "", "Recorded identity");
        identitySummary.dataset.artifactFocus = identityKey;
        identity.append(identitySummary, el("code", "", `Preview ${record.previewRevision} · Session ${record.runtimeSession}`));
        item.append(identity); records.append(item);
      }
      body.append(records);
    }
    if (expanded && proposal.verification?.length) {
      body.append(el("h3", "", "Suggested checks"));
      const list = el("ul");
      for (const check of proposal.verification.slice(0, 12)) list.append(el("li", "", check));
      body.append(list, el("p", "artifact-boundary", "These suggestions have not been executed."));
    }
    if (embedded) { body.prepend(el("h3", "checks-title", "Checks")); body.classList.add("embedded-checks"); return body; }
    const id = `proposal/${proposal.id}/verification`;
    return artifactCard({id, kind:"Verification", title:"Checks", status:status.compilation === "not-run" ? history.length ? "Historical results" : "Not run" : "Partial coverage", scope:"3 checks", provenance:status.revision ? "Observed" : history.length ? "Saved observation" : "No attached run", freshness:status.revision ? status.revision.slice(0, 7) : "", body, expanded,
      open:() => openArtifact({kind:"verification", proposalId:proposal.id}), actions:expanded ? [] : [artifactButton("Inspect evidence", () => openArtifact({kind:"verification", proposalId:proposal.id}), `${id}:review`)]});
  }
  function activeChangeSet() {
    const group=state.changeSetSession?.current;
    return group && !["discarded","undone"].includes(group.status) ? group : null;
  }
  function currentChangeSet(id) {
    return state.changeSetSession?.current?.id===id ? state.changeSetSession.current : state.changeSetSession?.versions?.find(item=>item.group?.id===id)?.group || state.turns.find(turn=>turn.changeSet?.id===id)?.changeSet;
  }
  function changeSetOwner(group) {
    for(const conversation of state.conversations?.conversations || []) {
      const turn=conversation.turns.find(turn=>turn.changeSet?.id===group.id);
      if(turn)return {turn,conversation};
      for(const owner of conversation.turns){const candidate=owner.alternatives?.candidates?.find(item=>item.changeSet?.id===group.id);if(candidate)return {turn:owner,conversation,candidate,alternatives:owner.alternatives};}
    }
    return null;
  }
  function changeSetView(group) {
    const owner=changeSetOwner(group),local=group.origin==="alternative",authority=local && state.changeSetSession?.alternativeAuthority?.groupId===group.id?state.changeSetSession.alternativeAuthority:null;
    const view=artifacts.changeSetState(group,state.changeSetSession,{trusted:state.trusted,running:state.running || Boolean(pendingAcceptanceAction) || alternativeOperationBusy(),
      ownerReady:local?Boolean(authority):Boolean(owner && owner.turn.state==="complete" && !owner.turn.completedWhileStopping && !owner.conversation.archived && (!assistantSurface || owner.conversation.id===state.conversations?.activeId)),
      historyReady:local || state.conversations?.storage?.status==="saved",dirtyPaths:state.dirtyPaths,executionBusy:Boolean(state.executionSession?.busy || state.executionSession?.planSession?.busy)});
    if(local){
      view.canApply=view.canApply && authority?.canApply===true && !view.acceptance.value;view.canUndo=view.canUndo && authority?.canUndo===true && !view.acceptance.value;
      view.acceptance={...view.acceptance,canPrepare:false,canSelect:false,canClear:false};
      if(!authority || authority.reason)view.reason=authority?.reason || "Retained source authority is unavailable. Review the saved alternative again.";
    }
    if(owner?.candidate){view.canApply=false;view.canUndo=false;view.acceptance={...view.acceptance,canPrepare:false,canSelect:false,canClear:false};}
    if(alternativeOperationBusy())view.reason="Finish the alternative comparison or review before changing source.";
    return view;
  }
  function groupVersionView(group) {
    if(group.origin==="alternative" || state.changeSetSession?.current?.origin==="alternative")return {retained:false,canRestore:false,reason:"Retained alternatives are reviewed as whole groups."};
    const owner=changeSetOwner(group),currentOwner=changeSetOwner(state.changeSetSession?.current || {});
    return artifacts.groupVersionState(group,state.changeSetSession,{trusted:state.trusted,running:state.running || Boolean(pendingAcceptanceAction) || alternativeOperationBusy(),executionBusy:Boolean(state.executionSession?.busy || state.executionSession?.planSession?.busy),historyReady:state.conversations?.storage?.status==="saved",dirtyPaths:state.dirtyPaths,
      ownerReady:Boolean(owner && currentOwner && owner.turn.state==="complete" && currentOwner.turn.state==="complete" && !owner.turn.completedWhileStopping && !currentOwner.turn.completedWhileStopping && !owner.conversation.archived && !currentOwner.conversation.archived && owner.conversation.id===state.conversations?.activeId && currentOwner.conversation.id===state.conversations?.activeId)});
  }
  function changeSetAction(group,action,fileId,unitIds) {
    const view=group?changeSetView(group):null;
    const allowed=action==="retry" ? state.trusted && !state.running && !state.changeSetSession?.busy && ["error","unavailable"].includes(state.changeSetSession?.storage?.status)
      : action==="prepareAcceptance"?view?.acceptance.canPrepare:action==="selectUnits"?view?.acceptance.canSelect:action==="clearAcceptance"?view?.acceptance.canClear:action==="activateVersion"?groupVersionView(group).canRestore:action==="apply"?view?.canApply:action==="undo"?view?.canUndo:action==="recover"?view?.canRecover:action==="discard"?view?.canDiscard:action==="diff"?view?.canDiff:view?.canRefresh;
    if(alternativeOperationBusy() || !allowed || !state.project || fileId && !group.files.some(file=>file.id===fileId))return;
    if(action==="selectUnits" && (!Array.isArray(unitIds) || new Set(unitIds).size!==unitIds.length || unitIds.some(id=>!view.acceptance.pending.some(unit=>unit.id===id))))return;
    if(["prepareAcceptance","selectUnits","clearAcceptance"].includes(action))pendingAcceptanceAction={projectId:state.project.id,groupId:group.id,revision:group.revision,seenBusy:false,...(action==="selectUnits"?{unitIds:[...unitIds]}:{})};
    vscode.postMessage({type:"changeSetAction",action,projectId:state.project.id,...(group?{changeSetId:group.id,expectedRevision:group.revision}:{}),...(fileId?{fileId}:{}),...((action==="apply" && view.acceptance.value || action==="selectUnits")?{planDigest:view.acceptance.plan.digest}:{}),...(action==="selectUnits"?{unitIds}:{}),...(action==="activateVersion"?{expectedCurrentId:state.changeSetSession.current.id,expectedCurrentRevision:state.changeSetSession.current.revision}:{})});
    if(pendingAcceptanceAction){if(assistantSurface)renderAssistant();else render();}
  }
  function changeSetStorageNotice() {
    const session=state.changeSetSession;
    if(!session || session.current || !["error","unavailable","saving"].includes(session.storage?.status) && !session.error)return null;
    const box=el("section","change-set-storage");box.setAttribute("aria-label","Change group storage");box.append(note(session.error || session.storage.message || (session.storage.status==="saving"?"Saving staged changes…":"Change group storage is unavailable."),"warning"));
    if(["error","unavailable"].includes(session.storage.status)){const retry=button("Retry change storage",()=>changeSetAction(null,"retry"),"button","refresh");retry.disabled=!state.trusted || state.running || Boolean(session.busy);box.append(retry);}return box;
  }
  function changeSetFileStatus(group,file,view) {
    if(!view.current)return "Saved snapshot";
    const measured=state.changeSetSession?.assessment?.files?.find(item=>item.path===file.path);
    const source=state.dirtyPaths.includes(file.path) || measured?.dirty?"Unsaved changes":measured?.state==="conflict"?"Changed on disk":measured?.state==="unavailable"?"Unavailable":measured?.state==="after"?"Matches staged source":measured?.state==="before"?"Matches baseline":"Not checked";
    return view.acceptance?.valid?`${view.acceptance.appliedPaths.includes(file.path)?"Applied":"Pending"} · ${source}`:measured?.state==="after" && source==="Matches staged source"?"Applied source":source;
  }
  function executionView(group) {
    const owner=changeSetOwner(group),view=changeSetView(group);
    return artifacts.executionState(group,state.executionSession,{current:view.current,groupReady:state.changeSetSession?.assessment?.canApply===true && artifacts.acceptanceState(group,state.changeSetSession).fullSelection && !(group.context || []).some(source=>state.dirtyPaths.includes(source.path)),
      trusted:state.trusted,running:state.running || Boolean(pendingAcceptanceAction) || alternativeOperationBusy(),ownerReady:Boolean(owner && owner.turn.state==="complete" && !owner.turn.completedWhileStopping && !owner.conversation.archived && (!assistantSurface || owner.conversation.id===state.conversations?.activeId)),historyReady:state.conversations?.storage?.status==="saved"});
  }
  function executionAction(group,action,taskId) {
    if(group.origin==="alternative" || alternativeOperationBusy())return;
    const view=executionView(group),allowed=action==="prepare"?view.canPrepare:action==="run"?view.canRun:action==="stop"?view.canStop:action==="retry"?view.canRetry:false;
    if(!allowed || !state.project || action==="run" && !view.current?.tasks?.some(task=>task.id===taskId))return;
    vscode.postMessage({type:"executionAction",action,projectId:state.project.id,changeSetId:group.id,expectedGroupRevision:group.revision,
      ...(view.current?{executionId:view.current.id,expectedRevision:view.current.revision}:{}),...(action==="run"?{taskId}:{})});
  }
  function checkPlanView(group) {
    const owner=changeSetOwner(group),current=state.changeSetSession?.current;
    return artifacts.checkPlanState(group,state.executionSession,{current:current?.id===group.id && current.revision===group.revision,groupReady:state.changeSetSession?.assessment?.canApply===true && artifacts.acceptanceState(group,state.changeSetSession).fullSelection && !(group.context || []).some(source=>state.dirtyPaths.includes(source.path)),
      trusted:state.trusted,running:state.running || Boolean(pendingAcceptanceAction) || alternativeOperationBusy(),ownerReady:Boolean(owner && owner.turn.state==="complete" && !owner.turn.completedWhileStopping && !owner.conversation.archived && owner.conversation.id===state.conversations?.activeId),historyReady:state.conversations?.storage?.status==="saved"});
  }
  function checkPlanAction(group,action,taskIds) {
    if(group.origin==="alternative" || alternativeOperationBusy())return;
    const view=checkPlanView(group),plan=view.plan,allowed=({create:view.canCreate,runNext:view.canRunNext,retryStep:view.canRetryStep,skipStep:view.canSkipStep,stop:view.canStop,end:view.canEnd,retryStorage:view.canRetryStorage})[action];
    if(!allowed || !state.project)return;
    const ready=state.executionSession.current;
    if(action==="create" && (!Array.isArray(taskIds) || !taskIds.length || taskIds.length>2 || new Set(taskIds).size!==taskIds.length || !taskIds.every(id=>ready.tasks.some(task=>task.id===id))))return;
    vscode.postMessage({type:"checkPlanAction",action,projectId:state.project.id,changeSetId:action==="create"?group.id:plan?.groupId || group.id,expectedGroupRevision:action==="create"?group.revision:plan?.groupRevision ?? group.revision,
      ...(action==="create"?{executionId:ready.id,expectedExecutionRevision:ready.revision,taskIds}:plan?{planId:plan.id,expectedRevision:plan.revision}:{}),
      ...(action==="retryStep"?{stepId:view.retry.id}:action==="skipStep"?{stepId:view.next.id}:action==="stop"?{attemptId:plan.activeAttemptId}:{})});
  }
  function checkPlanCreator(group,key,view) {
    const record=state.executionSession?.current;if(!view.session || view.active || record?.status!=="ready" || record.groupId!==group.id || record.groupRevision!==group.revision)return null;
    const tasks=(record.tasks || []).slice(0,2);if(!tasks.length)return null;
    const selected=(checkPlanTaskSelections.get(record.id) || tasks.map(task=>task.id)).filter(id=>tasks.some(task=>task.id===id));
    const contents=[el("p","artifact-boundary","Choose checks in order. Saving a plan runs nothing. Each Run or Retry uses a fresh copy.")],list=el("ol","check-plan-choices");
    for(const task of tasks){const item=el("li"),label=el("label"),input=el("input");input.type="checkbox";input.checked=selected.includes(task.id);input.disabled=!view.canCreate;input.setAttribute("aria-label",`Include ${task.label}`);input.dataset.artifactFocus=`${key}:plan-task:${task.id}`;input.addEventListener("change",()=>{checkPlanTaskSelections.set(record.id,input.checked?[...selected,task.id]:selected.filter(id=>id!==task.id));if(state.mode==="Assistant")renderAssistant();else render();});label.append(input,el("span","",task.label));item.append(label);list.append(item);}
    contents.push(list);
    if(selected.length>1){contents.push(el("p","artifact-boundary",selected.map(id=>tasks.find(task=>task.id===id).label).join(" → ")));const reorder=artifactButton("Reverse check order",()=>{checkPlanTaskSelections.set(record.id,[...selected].reverse());if(state.mode==="Assistant")renderAssistant();else render();},`${key}:plan-order`);reorder.disabled=!view.canCreate;contents.push(reorder);}
    const save=artifactButton("Save check plan",()=>checkPlanAction(group,"create",selected),`${key}:plan-create`,true);save.disabled=!view.canCreate || !selected.length;contents.push(save);
    return contentDetails("Save a check plan",`${key}:plan-creator`,contents,"content-details check-plan-creator");
  }
  function checkPlanCard(group,key,view,plan=view.plan,historical=false) {
    if(!plan)return null;
    const box=el("section","check-plan");box.setAttribute("aria-label",historical?"Earlier check plan":"Check plan");box.dataset.checkPlanId=plan.id;
    const head=el("div","execution-heading");head.append(el("h3","",historical?"Earlier check plan":"Check plan"),el("span","execution-status",historical?plan.status:view.status));box.append(head);
    if(!historical && !view.exact)box.append(el("p","artifact-boundary","Historical plan; its results do not verify this group revision."));
    if(!historical && view.reason)box.append(el("p","artifact-boundary",view.reason));
    if(!historical && view.session?.error && view.session.error!==view.reason)box.append(note(view.session.error,"warning"));
    const list=el("ol","check-plan-steps");list.setAttribute("aria-label","Planned checks");
    for(const [index,step] of plan.steps.entries()){
      const row=el("li","check-plan-step"),last=step.attempts.at(-1),current=!historical && (view.next?.id===step.id || plan.activeAttemptId && step.attempts.some(attempt=>attempt.id===plan.activeAttemptId));row.dataset.checkStepId=step.id;
      const status=step.status==="passed"?"Passed":step.status==="skipped"?(last?"Skipped · Earlier attempts retained":"Skipped · Not run"):!historical && plan.status==="running" && !view.busy && last && ["preparing","ready","running"].includes(last.status)?"Awaiting saved outcome":last?({preparing:"Preparing…",ready:"Preparing…",running:"Running…",failed:"Failed · Decision needed",cancelled:"Stopped · Decision needed",interrupted:"Interrupted · Decision needed",unavailable:"Unavailable · Decision needed"})[last.status] || "Pending":"Not run";
      const title=el("div","execution-result-heading");title.append(el("strong","",`${index+1}. ${step.task.label}`),el("span","",status));row.append(title);
      const details=[el("code","execution-command",executionCommand(step.task))];
      for(const [attemptIndex,attempt] of step.attempts.entries()){
        const attemptBox=el("div","check-plan-attempt"),record=[state.executionSession?.current,...(state.executionSession?.history || [])].find(record=>record?.id===attempt.executionId && record.groupId===plan.groupId && record.groupRevision===plan.groupRevision && record.plan?.planId===plan.id && record.plan.stepId===step.id && record.plan.attemptId===attempt.id);
        attemptBox.append(el("p","artifact-boundary",`Attempt ${attemptIndex+1} · ${!historical && plan.status==="running" && !view.busy && ["preparing","ready","running"].includes(attempt.status)?"Awaiting saved outcome":executionView(group).statusLabel(attempt.status)}`));
        if(record)attemptBox.append(executionResult(record,`${key}:plan:${plan.id}:step:${step.id}:attempt:${attempt.id}`,executionView(group),true,false));else if(attempt.reason)attemptBox.append(el("p","artifact-boundary",attempt.reason));
        if(attempt.executionId && !record)attemptBox.append(el("p","artifact-boundary","Command output is not available in retained execution history."));details.push(attemptBox);
      }
      if(current)row.append(...details);else row.append(contentDetails("Check details",`${key}:plan:${plan.id}:step:${step.id}`,details));list.append(row);
    }
    box.append(list);
    if(!historical){const actions=el("div","execution-actions"),add=(label,action,enabled,primary=false)=>{const control=artifactButton(label,()=>checkPlanAction(group,action),`${key}:plan:${action}`,primary,action==="stop"?"stop":undefined);control.disabled=!enabled;actions.append(control);};
      if(view.selected && ["paused","running"].includes(plan.status)){
        if(plan.activeAttemptId || plan.status==="running"){if(view.busy || view.canStop)add("Stop check","stop",view.canStop);}
        else {if(view.retry)add("Retry check","retryStep",view.canRetryStep,true);else if(view.next)add("Run next check","runNext",view.canRunNext,true);if(view.next)add("Skip check","skipStep",view.canSkipStep);add("End plan","end",view.canEnd);}
      }
      if(view.canRetryStorage)add("Retry plan storage","retryStorage",true);if(actions.childElementCount)box.append(actions);
      if(view.selected && plan.status==="paused")box.append(el("p","artifact-boundary","Checks run only when you choose Run or Retry. Skip records no pass; End keeps prior results."));
    }
    box.append(contentDetails("Plan details",`${key}:plan:${plan.id}:identity`,[el("p","artifact-boundary",`Group ${plan.groupId} · revision ${plan.groupRevision}`),el("p","artifact-boundary",`Source snapshot ${plan.snapshotRevision}`),el("code","execution-identity",plan.id)]));return box;
  }
  function orphanCheckPlanNotice() {
    const plan=state.executionSession?.planSession?.current;if(!plan || !["paused","running"].includes(plan.status))return null;
    const group=state.changeSetSession?.current,visible=assistantSurface?state.turns.some(turn=>turn.changeSet?.id===plan.groupId):Boolean(group);
    if(visible && group?.id===plan.groupId && group.revision===plan.groupRevision && group.status==="proposed")return null;
    const basis=currentChangeSet(plan.groupId) || {id:plan.groupId,revision:plan.groupRevision,status:"stale",files:[],context:[]},view=checkPlanView(basis),box=el("section","change-set-storage");box.setAttribute("aria-label","Unfinished check plan");box.append(el("p","artifact-boundary","An earlier check plan is unfinished. End it to prepare checks for another group. Prior results stay saved."));
    if(view.canStop)box.append(artifactButton("Stop check",()=>checkPlanAction(basis,"stop"),"unfinished-plan:stop"));else {const end=artifactButton("End plan",()=>checkPlanAction(basis,"end"),"unfinished-plan:end");end.disabled=!view.canEnd;box.append(end);}if(view.canRetryStorage)box.append(artifactButton("Retry plan storage",()=>checkPlanAction(basis,"retryStorage"),"unfinished-plan:retry"));return box;
  }
  function executionCommand(task) { return Array.isArray(task?.command)?task.command.join(" "):typeof task?.command==="string"?task.command:""; }
  function executionResult(record,key,view,latest=false,showTask=true) {
    const result=el("div","execution-result");
    const task=record.tasks?.find(task=>task.id===record.taskId);
    if(showTask && task || !latest){const line=el("div","execution-result-heading");line.append(el("strong","",task?.label || "Isolated workspace"));if(!latest)line.append(el("span","",view.statusLabel(record.status)));result.append(line);}
    if(showTask && task)result.append(el("code","execution-command",executionCommand(task)));
    if(record.reason)result.append(el("p","artifact-boundary",record.reason));
    const outcome=record.exitCode!==undefined && record.exitCode!==null?`Exit ${record.exitCode}`:record.signal?`Signal ${record.signal}`:"";
    const metadata=[outcome,record.finishedAt?formatHistoryTime(record.finishedAt):record.startedAt?`Started ${formatHistoryTime(record.startedAt)}`:""].filter(Boolean).join(" · ");
    if(metadata)result.append(el("p","artifact-boundary",metadata));
    if(typeof record.output==="string" && record.output){
      const output=el("pre","execution-output",record.output.slice(0,65536));output.tabIndex=0;output.setAttribute("aria-label","Command output");output.dataset.artifactFocus=`${key}:output:${record.id}`;output.dataset.executionId=record.id;
      const restoreOutput=()=>{if(output.isConnected && output.getClientRects().length)output.scrollTop=executionOutputScroll.get(record.id) || 0;};
      output.addEventListener("scroll",()=>executionOutputScroll.set(record.id,output.scrollTop));requestAnimationFrame(restoreOutput);
      const contents=[output];if(record.outputTruncated || record.output.length>65536)contents.push(el("p","artifact-boundary","Output limit reached. The retained output is incomplete."));
      const details=contentDetails("Command output",`${key}:output-details:${record.id}`,contents,"content-details execution-output-details");details.addEventListener("toggle",()=>{if(details.open)restoreOutput();});result.append(details);
    }
    const basis=[el("p","artifact-boundary",`Group revision ${record.groupRevision}${record.snapshotRevision?` · Snapshot ${record.snapshotRevision.slice(0,12)}`:""}`)];
    if(Number.isSafeInteger(record.files))basis.push(el("p","artifact-boundary",`${record.files} files${Number.isSafeInteger(record.bytes)?` · ${Math.ceil(record.bytes/1024)} KiB`:""}`));
    basis.push(el("code","execution-identity",record.id));result.append(contentDetails("Run details",`${key}:identity:${record.id}`,basis));
    return result;
  }
  function executionSection(group,key,expanded) {
    const view=executionView(group),session=state.executionSession,basePlanView=checkPlanView(group),chosenPlan=basePlanView.plans.find(plan=>plan.id===checkPlanSelectedIds.get(group.id) && plan.groupId===group.id),historicalPlan=chosenPlan && chosenPlan.id!==basePlanView.plan?.id?chosenPlan:null,planView=basePlanView;
    if(!expanded){
      if(planView.plan){const summary=el("p","execution-summary");summary.append(icon("terminal",14),el("span","",`Check plan · ${planView.status}`));return summary;}
      if(!view.latest)return null;
      const summary=el("p","execution-summary");summary.append(icon("terminal",14),el("span","",`Isolated check · ${view.status}${view.historical?" · Historical":""}`));return summary;
    }
    if(!view.current && !view.latest && !changeSetView(group).current)return null;
    const section=el("section","execution-check");section.setAttribute("aria-label","Check in isolation");
    const header=el("div","execution-heading"),status=el("span","execution-status",planView.plan?"Manual checks":view.status);status.setAttribute("role","status");header.append(el("h3","","Check in isolation"),status);section.append(header);
    section.append(el("p","artifact-boundary","Run a supported check against a separate copy of the staged source. Project files stay unchanged."));
    if(view.supported)section.append(el("p","execution-scope","Network blocked · Writes stay in this copy · Tools can read local files."));
    if((!planView.active || ["error","unavailable"].includes(session?.storage?.status)) && view.reason && view.reason!==view.current?.reason)section.append(el("p","artifact-boundary",view.reason));
    if(session?.error)section.append(note(session.error,"warning"));
    if(historicalPlan){section.append(checkPlanCard(group,`${key}:selected`,planView,historicalPlan,true));if(planView.plan)section.append(artifactButton("View current check plan",()=>{checkPlanSelectedIds.delete(group.id);renderAssistant();},`${key}:plan-current`));}
    else if(planView.plan)section.append(checkPlanCard(group,key,planView));
    const previousPlans=planView.plans.filter(plan=>plan.groupId===group.id && plan.id!==planView.plan?.id && plan.id!==historicalPlan?.id);
    if(previousPlans.length)section.append(contentDetails(`Earlier plans · ${previousPlans.length}`,`${key}:plan-history`,previousPlans.map(plan=>checkPlanCard(group,`${key}:history`,planView,plan,true))));
    if(planView.canRetryStorage && !planView.plan){section.append(el("p","artifact-boundary",planView.reason),artifactButton("Retry plan storage",()=>checkPlanAction(group,"retryStorage"),`${key}:plan:retryStorage`));}
    if(!planView.active && view.current?.status==="ready"){
      const tasks=view.current.tasks || [],selected=tasks.find(task=>task.id===executionTaskSelections.get(view.current.id)) || tasks[0];
      if(selected){const field=el("label","execution-task-field","Check"),select=el("select");select.setAttribute("aria-label","Isolated check");select.dataset.designFocus=`${key}:execution-task`;
        for(const task of tasks){const option=el("option","",task.label);option.value=task.id;select.append(option);}select.value=selected.id;
        select.disabled=!view.canRun;select.addEventListener("change",()=>{executionTaskSelections.set(view.current.id,select.value);if(state.mode==="Assistant")renderAssistant();else render();});field.append(select);section.append(field,el("code","execution-command",executionCommand(selected)));}
    }
    if(assistantSurface && view.current?.status==="ready" && !planView.active){const suggest=artifactButton("Suggest checks",()=>prepareCheckSuggestion(group),`${key}:suggest-checks`,false,"spark"),reason=checkPreparationReason(group);suggest.disabled=Boolean(reason);if(reason)suggest.title=reason;section.append(suggest);if(checkSuggestionErrors.has(`group/${group.id}`))section.append(note(checkSuggestionErrors.get(`group/${group.id}`),"warning"));}
    const creator=checkPlanCreator(group,key,planView);if(creator)section.append(creator);
    const actions=el("div","execution-actions");
    if(!planView.active && view.current?.status==="ready") {const task=view.current.tasks?.find(task=>task.id===executionTaskSelections.get(view.current.id)) || view.current.tasks?.[0];const run=artifactButton("Run check",()=>executionAction(group,"run",task?.id),`${key}:execution:run`,true,"terminal");run.disabled=!view.canRun;actions.append(run);}
    if(!planView.active && (view.canStop || view.current && !view.current.plan && ["preparing","running"].includes(view.current.status))){const stop=artifactButton("Stop check",()=>executionAction(group,"stop"),`${key}:execution:stop`,false,"stop");stop.disabled=!view.canStop;actions.append(stop);}
    else if(!planView.active && changeSetView(group).current && group.status==="proposed" && (view.current?.status!=="ready" || !view.canRun && view.canPrepare)){const prepare=artifactButton(view.latest?"Prepare new workspace":"Prepare workspace",()=>executionAction(group,"prepare"),`${key}:execution:prepare`,!view.latest,"branch");prepare.disabled=!view.canPrepare;actions.append(prepare);}
    if(view.canRetry){actions.append(artifactButton("Retry execution storage",()=>executionAction(group,"retry"),`${key}:execution:retry`,false,"refresh"));}
    if(actions.childElementCount)section.append(actions);
    if(view.latest && !view.latest.plan && !planView.active){if(view.historical)section.append(el("p","artifact-boundary","Historical result; it does not verify the current project."));section.append(executionResult(view.latest,key,view,true));}
    const prior=view.records.filter(record=>!record.plan && record.id!==view.latest?.id);
    if(prior.length)section.append(contentDetails(`Earlier checks · ${prior.length}`,`${key}:execution-history`,prior.map(record=>executionResult(record,`${key}:history:${record.id}`,view))));
    section.append(el("p","artifact-boundary","Results describe this command and isolated source only. Interaction and visual checks have not run. Output is not sent to AI."));
    return section;
  }
  function groupVersionDetails(group,key) {
    if(group.origin==="alternative" || changeSetOwner(group)?.candidate)return [];
    const versions=artifacts.groupVersionChain(group,state.changeSetSession),index=versions.findIndex(item=>item.group?.id===group.id);if(index<0 || versions.length<2)return [];
    const parts=[],entry=versions[index];
    if(entry.parentId){const previous=currentChangeSet(entry.parentId);if(previous)parts.push(artifactButton("View previous group",()=>openArtifact({kind:"change-set",changeSetId:previous.id}),`${key}:previous`));}
    if(state.changeSetSession.current?.id!==group.id){const current=state.changeSetSession.current;if(current)parts.push(artifactButton("View current group",()=>openArtifact({kind:"change-set",changeSetId:current.id}),`${key}:current`));return parts;}
    const list=el("ol","group-version-list");for(const [i,item] of versions.entries()){
      const row=el("li"),copy=el("div");copy.append(el("strong","",`Version ${i+1} · ${item.group.id===group.id?"Current":"Earlier version"}`),el("span","",item.group.title));
      row.append(copy,artifactButton(`Review version ${i+1}`,()=>openArtifact({kind:"change-set",changeSetId:item.group.id}),`${key}:version:${item.group.id}`));list.append(row);
    }
    parts.push(contentDetails(`Group versions · ${versions.length}`,`${key}:versions`,[list,el("p","artifact-boundary","Restoring a version changes the staged group only. Project files stay unchanged. Checks belong to their original group and revision.")]));return parts;
  }
  function acceptanceSection(group,key,view,expanded) {
    const value=view.acceptance;if(!value.value)return null;
    const section=el("section","acceptance-scope");section.setAttribute("aria-label","Changes to apply");
    if(!value.valid){section.append(note(value.reason,"warning"));return section;}
    const heading=el("div","acceptance-heading");heading.append(el("strong","","Changes to apply"),el("span","",`${value.applied.length} applied · ${value.pending.length} pending`));section.append(heading);
    section.append(el("p","artifact-boundary",value.plan.mode==="atomic"?value.plan.boundaries.length?"Review as one unit. Foundation cannot establish separate units for this source.":"Review as one unit. Linked files stay together.":"Linked files stay together. Selection is saved locally; it does not change source."));
    if(expanded){
      const list=el("ul","acceptance-units");
      for(const unit of value.units){
        const saving=pendingAcceptanceAction?.groupId===group.id && pendingAcceptanceAction.revision===group.revision?pendingAcceptanceAction:null,displayIds=saving?.unitIds || value.selected.map(unit=>unit.id),visibleLabel=unit.paths.length===1?basename(unit.paths[0]):unit.label;
        const row=el("li","acceptance-unit"),applied=value.applied.some(item=>item.id===unit.id),selected=displayIds.includes(unit.id),copy=el("div","acceptance-unit-copy"),label=el("label","acceptance-unit-label");
        if(applied){label.append(icon("check",16));label.append(el("strong","",visibleLabel));}
        else{const input=el("input");input.type="checkbox";input.checked=selected;input.disabled=!value.canSelect && !saving;input.setAttribute("aria-disabled",String(!value.canSelect));input.dataset.acceptanceUnit=unit.id;input.dataset.artifactFocus=`${key}:unit:${unit.id}`;input.setAttribute("aria-label",`Include ${unit.label}`);input.addEventListener("change",()=>{if(saving){input.checked=selected;return;}const ids=value.units.filter(item=>item.id===unit.id?input.checked:value.selected.some(chosen=>chosen.id===item.id)).map(item=>item.id);changeSetAction(group,"selectUnits",undefined,ids);});label.append(input,el("strong","",visibleLabel));}
        copy.append(label);if(applied)copy.append(el("span","acceptance-unit-status","Applied"));const paths=el("ul","acceptance-unit-paths");for(const path of unit.paths)paths.append(el("li","",path));copy.append(paths);row.append(copy);list.append(row);
      }
      section.append(list);
      const preview=el("section","acceptance-preview");preview.setAttribute("aria-label","Selected apply scope");preview.append(el("strong","",`${value.selected.length} ${value.selected.length===1?"change":"changes"} · ${value.selectedPaths.length} ${value.selectedPaths.length===1?"file":"files"} selected`));
      if(value.selectedPaths.length){const paths=el("ul");for(const path of value.selectedPaths)paths.append(el("li","",path));preview.append(paths,el("p","artifact-boundary","Apply selected writes exactly these saved file changes. Other pending files stay unchanged."));}else if(["proposed","partially-applied"].includes(group.status))preview.append(el("p","artifact-boundary","Choose at least one pending change to apply."));section.append(preview);
    }else section.append(el("p","artifact-boundary",`${value.selected.length} ${value.selected.length===1?"change":"changes"} · ${value.selectedPaths.length} ${value.selectedPaths.length===1?"file":"files"} selected`));
    if(pendingAcceptanceAction?.groupId===group.id){const saving=el("p","artifact-boundary","Saving selection…");saving.setAttribute("role","status");section.append(saving);}
    const details=el("div","acceptance-details");details.append(el("p","artifact-boundary","Grouping comes from saved and staged source analysis. It does not establish runtime behavior."));for(const boundary of value.plan.boundaries)details.append(el("p","artifact-boundary",boundary));details.append(el("code","",`Plan ${value.plan.digest}`));section.append(contentDetails("Grouping details",`${key}:acceptance`,[details]));return section;
  }
  function changeSetDetails(group,key) {
    const parts=groupVersionDetails(group,key);
    if(group.verification?.length){parts.push(structuredList("Suggested checks · Not run",group.verification,`${key}:checks`));}
    if(!executionView(group).latest)parts.push(el("p","artifact-boundary","Build, interaction, and visual checks have not run for this group."));
    const basis=el("div","plan-source-basis");for(const source of group.context || [])basis.append(el("code","",`${source.path} · ${source.revision.slice(0,7)}`));
    if(group.context?.length)parts.push(contentDetails(`Source basis · ${group.context.length}`,`${key}:basis`,[basis]));
    const records=state.changeSetSession?.current?.id===group.id?state.changeSetSession.checkpoints || []:state.changeSetSession?.versions?.find(item=>item.group?.id===group.id)?.checkpoints || [],checkpoints=el("ol","change-set-checkpoints");for(const record of records){const row=el("li");row.append(el("span","",`${({staged:"Staged",applied:"Applied",undone:"Undone",recovered:"Restored"})[record.kind] || record.kind} · ${formatHistoryTime(record.createdAt)}`),el("code","",record.id));checkpoints.append(row);}
    if(records.length)parts.push(contentDetails(`Checkpoints · ${records.length}`,`${key}:checkpoints`,[checkpoints]));
    return parts;
  }
  function changeSetArtifact(group,expanded=false) {
    const key=`change-set/${group.id}`,view=changeSetView(group),body=el("div","change-set-body"),session=state.changeSetSession,generated=Boolean(changeSetOwner(group)?.candidate);
    body.append(el("p","",group.summary));
    if(generated)body.append(el("p","artifact-boundary","Compare this option, then review the retained result to apply it."));
    const acceptance=group.origin==="alternative" || generated?null:acceptanceSection(group,key,view,expanded);if(acceptance)body.append(acceptance);
    if(group.status==="proposed")body.append(el("p","artifact-boundary","Local snapshots; source unchanged."));
    if(group.status==="partially-applied")body.append(el("p","artifact-boundary","Accepted changes are on disk. Pending changes remain staged."));
    if(group.status==="recovery-required")body.append(note("A source operation stopped after some files may have changed. Restore checkpoint returns the group to its state before that operation. It will not overwrite conflicts or unsaved drafts.","warning"));
    if(expanded) {
      const file=group.files.find(file=>file.id===changeSetSelections.get(group.id)) || group.files[0];
      const field=el("label","change-set-file-picker","File"),select=el("select");select.setAttribute("aria-label","Changed file");select.dataset.designFocus=`${key}:file`;
      for(const entry of group.files){const option=el("option","",entry.path);option.value=entry.id;select.append(option);}select.value=file.id;
      select.addEventListener("change",()=>{changeSetSelections.set(group.id,select.value);if(state.mode==="Assistant")renderAssistant();else render();});field.append(select);body.append(field);
      const fileHead=el("div","change-set-file-heading");fileHead.append(el("code","",file.path),el("span","",changeSetFileStatus(group,file,view)));body.append(fileHead);
      const diff=el("div","proposal-diff-columns change-set-diff");diff.setAttribute("aria-label",`Staged changes in ${file.path}`);
      for(const [label,source] of [["Before",file.before],["After",file.after]]){const column=el("section");column.append(el("h3","",label),el("pre","",source));diff.append(column);}body.append(diff);
      const native=artifactButton("Open native diff",()=>changeSetAction(group,"diff",file.id),`${key}:diff`,false,"review");native.disabled=!view.canDiff;body.append(native);
      body.append(el("p","artifact-boundary",`Saved baseline ${file.baseRevision.slice(0,7)}${file.appliedRevision?` · applied ${file.appliedRevision.slice(0,7)}`:""}`));
    } else {
      const list=el("ul","change-set-files");list.setAttribute("aria-label","Changed files");for(const file of group.files){const row=el("li"),open=artifactButton("",()=>{changeSetSelections.set(group.id,file.id);openArtifact({kind:"change-set",changeSetId:group.id});},`${key}:file:${file.id}`,false,"source");open.classList.add("change-set-file");open.setAttribute("aria-label",`Review ${file.path}`);open.append(el("code","",file.path),el("span","",changeSetFileStatus(group,file,view)));row.append(open);list.append(row);}body.append(list);
    }
    body.append(...changeSetDetails(group,key));
    const execution=group.origin==="alternative" || generated?null:executionSection(group,key,expanded);if(execution){if(view.acceptance.value)body.append(el("p","artifact-boundary","Checks cover the whole proposal. They do not verify a narrower selection; earlier results remain historical."));body.append(execution);}
    const actions=[];
    if(!expanded)actions.push(artifactButton(view.current?"Review changes":"Inspect previous group",()=>openArtifact({kind:"change-set",changeSetId:group.id}),`${key}:review`,true,"review"));
    else if(view.current){
      if(!generated && ["proposed","partially-applied"].includes(group.status)){const apply=artifactButton(view.acceptance.value?"Apply selected":"Apply all",()=>changeSetAction(group,"apply"),`${key}:apply`,true,"check");apply.disabled=!view.canApply;actions.push(apply);}
      if(!generated && group.origin!=="alternative" && group.status==="proposed" && !view.acceptance.value){const choose=artifactButton("Choose changes",()=>changeSetAction(group,"prepareAcceptance"),`${key}:choose`);choose.disabled=!view.acceptance.canPrepare;actions.push(choose);}
      if(!generated && group.origin!=="alternative" && view.acceptance.valid && group.status==="proposed" && !view.acceptance.applied.length){const whole=artifactButton("Use whole proposal",()=>changeSetAction(group,"clearAcceptance"),`${key}:whole`);whole.disabled=!view.acceptance.canClear;actions.push(whole);}
      if(["applied","partially-applied"].includes(group.status)){const undo=artifactButton(view.acceptance.value?"Undo accepted":"Undo all",()=>changeSetAction(group,"undo"),`${key}:undo`,false,"history");undo.disabled=!view.canUndo;actions.push(undo);body.append(el("p","artifact-boundary",view.acceptance.value?`Undo accepted restores ${view.acceptance.appliedPaths.length} accepted ${view.acceptance.appliedPaths.length===1?"file":"files"} together. Pending files are excluded; accepted contents must still match.`:"Undo restores all changed files only while their applied contents still match."));}
      if(group.status==="recovery-required"){const recover=artifactButton("Restore checkpoint",()=>changeSetAction(group,"recover"),`${key}:recover`,true,"refresh");recover.disabled=!view.canRecover;actions.push(recover);}
      const refresh=artifactButton("Check source",()=>changeSetAction(group,"refresh"),`${key}:refresh`,false,"refresh");refresh.disabled=!view.canRefresh;actions.push(refresh);
      if(["proposed","partially-applied","stale","applied"].includes(group.status)){const discard=artifactButton(["applied","partially-applied"].includes(group.status)?"Dismiss checkpoint":"Discard group",()=>changeSetAction(group,"discard"),`${key}:discard`);discard.disabled=!view.canDiscard;actions.push(discard);if(["applied","partially-applied"].includes(group.status))body.append(el("p","artifact-boundary",group.status==="partially-applied"?"Dismissing keeps accepted source changes and closes the remaining staged changes.":"Dismissing this checkpoint leaves all applied source changes in place."));}
    }
    if(assistantSurface && !generated && group.origin!=="alternative" && view.current && group.status==="proposed"){
      const refine=artifactButton("Refine group",()=>prepareGroupRevision(group),`${key}:refine`);const reason=groupPreparationReason(group);refine.disabled=Boolean(reason);if(reason)refine.title=reason;actions.push(refine);
    }
    if(expanded && !generated && !view.current && groupVersionView(group).retained){
      const version=groupVersionView(group),restore=artifactButton("Restore version",()=>changeSetAction(group,"activateVersion"),`${key}:restore-version`);restore.disabled=!version.canRestore;if(version.reason)restore.title=version.reason;actions.push(restore);body.append(el("p","artifact-boundary","Restore makes this the staged group. Project files stay unchanged; earlier checks remain historical."));if(version.reason)body.append(el("p","artifact-boundary",version.reason));
    }
    if(groupRevisionErrors.has(group.id))body.append(note(groupRevisionErrors.get(group.id),"error"));
    if(view.current && ["error","unavailable"].includes(session?.storage?.status)){const retry=artifactButton("Retry change storage",()=>changeSetAction(group,"retry"),`${key}:retry`,false,"refresh");retry.disabled=!state.trusted || state.running || Boolean(session.busy);actions.push(retry);}
    const selectionGuidance=view.acceptance.valid && !view.acceptance.selected.length && [view.acceptance.reason,"Choose at least one pending unit to apply."].includes(view.reason);
    return artifactCard({id:key,kind:"Change group",title:group.title,status:view.status,scope:`${group.files.length} ${group.files.length===1?"file":"files"}`,provenance:group.origin==="alternative"?"Retained alternative":"AI interpretation",freshness:view.freshness,body,actions,expanded,warnings:[selectionGuidance || !view.current && groupVersionView(group).retained?"":view.reason,view.current?session?.error:"",view.current && session?.storage?.status!=="saved"?session?.storage?.message:""],open:()=>openArtifact({kind:"change-set",changeSetId:group.id})});
  }
  function validateAlternativeDraft(value) {
    if(!value || typeof value!=="object" || Array.isArray(value) || Object.keys(value).some(key=>!["version","scenarioId","featureRevision","definitionRevision"].includes(key)) || value.version!==1 || !validAssistantIdentity(value.scenarioId,true) || ![value.featureRevision,value.definitionRevision].every(revision=>revision===null || Number.isSafeInteger(revision)&&revision>=0))return null;
    if(value.scenarioId===null && (value.featureRevision!==null || value.definitionRevision!==null))return null;
    return {version:1,scenarioId:value.scenarioId,featureRevision:value.featureRevision,definitionRevision:value.definitionRevision};
  }
  function aiAlternativesView() {const view=state.aiAlternatives;return state.trusted && view?.projectId===state.project?.id && Array.isArray(view.choices) && Array.isArray(view.reviewChoices)?view:null;}
  function selectedAlternativeGeneration() {
    const draft=state.alternativeGenerationDraft;if(!draft)return null;
    const choice=aiAlternativesView()?.choices.find(item=>item.scenarioId===draft.scenarioId),generation=choice?.generation;
    return choice?.canChoose===true && generation?.version===1 && generation.count===2 && generation.scope?.feature?.id===activeFeature()?.id && generation.scope.feature.revision===draft.featureRevision && generation.scope.definitionRevision===draft.definitionRevision?generation:null;
  }
  function aiAlternativeBlocker() {
    if(!state.alternativeGenerationDraft)return pendingAIAlternative?"Preparing the selected alternative…":"";
    if(state.intent!=="build" || state.planContext || state.requestRevision || state.groupRevision || state.checkContext || state.investigationContext || state.continuationContext || state.decisionContext.length || state.issueContext.length || state.featureTaskIncluded || state.runtimeObservationIds.length)return "Alternatives share the brief, selected saved source and chosen scenario only. Remove other request context first.";
    if(!aiAlternativesView())return "Alternative generation is unavailable. Open a saved feature and scenario.";
    if(aiAlternativesView().busy)return "Finish the current source or runtime action first.";
    if(!selectedAlternativeGeneration())return state.alternativeGenerationDraft.scenarioId?"The chosen scope changed. Choose the scenario again.":"Choose a saved scenario for these alternatives.";
    const paths=selectedAlternativeGeneration().scope.feature.paths,files=selectedFiles();
    if(files.length<2 || files.length>8 || files.some(file=>!paths.includes(file.path)))return "Select two to eight saved source files from this feature.";
    return "";
  }
  function alternativeGenerationCard() {
    if(state.intent!=="build")return null;
    const card=el("section","ai-alternative-generation");card.setAttribute("aria-label","Generate alternatives");
    const label=el("label","context-choice"),toggle=el("input");toggle.type="checkbox";toggle.checked=Boolean(state.alternativeGenerationDraft);toggle.disabled=state.running;toggle.setAttribute("aria-label","Explore alternatives");toggle.dataset.artifactFocus="alternatives/enable";toggle.dataset.aiAlternatives="explore";
    toggle.addEventListener("change",()=>{const enabled=toggle.checked;detachRequestRevision();state.planContext=null;if(enabled){state.alternativeGenerationDraft={version:1,scenarioId:null,featureRevision:null,definitionRevision:null};state.featureTaskIncluded=false;state.decisionContext=[];state.issueContext=[];state.runtimeObservationIds=[];}markAssistantDraftEdited();saveView();renderAssistant();});label.append(toggle,el("span","","Explore alternatives"));card.append(label);
    if(!state.alternativeGenerationDraft)return card;
    const field=el("label","ai-alternative-scenario","Scenario"),select=el("select");select.setAttribute("aria-label","Alternative scenario");select.dataset.artifactFocus="alternatives/scenario";select.disabled=state.running;const none=el("option","","Choose scenario");none.value="";select.append(none);
    for(const choice of aiAlternativesView()?.choices || []){const option=el("option","",choice.generation?.scope?.scenario?.title || choice.scenarioId);option.value=choice.scenarioId;option.disabled=!choice.canChoose;select.append(option);}
    select.value=state.alternativeGenerationDraft.scenarioId || "";select.addEventListener("change",()=>{const choice=aiAlternativesView()?.choices.find(item=>item.scenarioId===select.value);state.alternativeGenerationDraft=choice?.canChoose?{version:1,scenarioId:choice.scenarioId,featureRevision:choice.generation.scope.feature.revision,definitionRevision:choice.generation.scope.definitionRevision}:{version:1,scenarioId:null,featureRevision:null,definitionRevision:null};markAssistantDraftEdited();saveView();renderAssistant();});field.append(select);card.append(field);
    const generation=selectedAlternativeGeneration();if(generation){const scope=generation.scope;card.append(el("p","artifact-boundary",`${scope.feature.title} · ${scope.screen.title} · ${scope.scenario.title}`),contentDetails("Exact scope to share","alternatives/request-scope",[el("pre","ai-alternative-json",JSON.stringify(generation,null,2))]));}
    card.append(el("p","artifact-boundary","Two options from the same saved source. Review and compare each before applying. Generation runs no checks and changes no project files."));return card;
  }
  function aiAlternativeReview(turn,candidate) {
    const view=aiAlternativesView(),chat=activeConversation(),choice=view?.reviewChoices.find(item=>item.conversationId===chat?.id && item.requestId===turn.requestId && item.artifactId===turn.alternatives?.id && item.candidateId===candidate.id);
    if(!choice?.canReview || chat?.archived || view.busy || pendingAIAlternative || state.running || turn.state!=="complete" || turn.completedWhileStopping || state.conversations?.storage?.status!=="saved")return;
    pendingAIAlternative={projectId:state.project.id,conversationId:chat.id,requestId:turn.requestId,artifactId:turn.alternatives.id,candidateId:candidate.id,digest:choice.digest};
    vscode.postMessage({type:"aiAlternativeAction",action:"review",...pendingAIAlternative});renderAssistant();
  }
  function aiAlternativesArtifact(turn) {
    const value=turn.alternatives,view=aiAlternativesView(),chat=activeConversation(),key=`ai-alternatives/${value.id}`,body=el("section","ai-alternatives-artifact");body.setAttribute("aria-label","AI alternatives");body.dataset.artifactId=key;
    body.append(el("div","artifact-eyebrow","AI interpretation · Two alternatives"),el("h3","",value.title),el("p","",value.summary),el("p","artifact-boundary","Generation does not select or apply an option. Compilation, interaction and visual checks are separate."));
    const scope=value.generation?.scope;if(scope)body.append(contentDetails("Generation scope",`${key}/scope`,[el("p","",`${scope.feature.title} · ${scope.screen.title} · ${scope.scenario.title}`),el("pre","ai-alternative-json",JSON.stringify(value.generation,null,2))]));
    for(const [index,candidate] of (value.candidates || []).entries()){
      const section=el("section","ai-alternative-candidate");section.setAttribute("aria-label",candidate.name);section.dataset.aiCandidateId=candidate.id;
      section.append(el("span","ai-alternative-number",`Option ${index+1}`),el("h4","",candidate.name),el("p","",candidate.reason));
      const files=el("ul","ai-alternative-files");for(const file of candidate.changeSet?.files || [])files.append(el("li","",file.path));section.append(files);
      const choice=view?.reviewChoices.find(item=>item.conversationId===chat?.id && item.requestId===turn.requestId && item.artifactId===value.id && item.candidateId===candidate.id),retained=state.changeSetSession?.current?.id===candidate.changeSet?.id || state.changeSetSession?.versions?.some(item=>item.group?.id===candidate.changeSet?.id),review=artifactButton(retained?"Inspect reviewed candidate":"Review candidate",()=>retained?openArtifact({kind:"change-set",changeSetId:candidate.changeSet.id}):aiAlternativeReview(turn,candidate),`${key}/${candidate.id}/review`,true,"review");
      review.disabled=retained?false:!choice?.canReview || chat?.archived || Boolean(view?.busy || pendingAIAlternative || state.running) || turn.state!=="complete" || turn.completedWhileStopping || state.conversations?.storage?.status!=="saved";
      if(!retained && choice?.reason){review.title=choice.reason;section.append(el("p","artifact-boundary",choice.reason));}
      if(retained)section.append(el("p","artifact-boundary",state.changeSetSession?.current?.id===candidate.changeSet.id?"Current review checkpoint. Compare it in Review.":"Retained source review. Its comparison remains in Review."));
      section.append(review);body.append(section);
    }
    body.append(sourceSnapshots(turn.context,`${key}/sources`,false,"Saved generation source"));return body;
  }
  function changeSetBuildBlocker() {
    const session=state.changeSetSession,group=activeChangeSet();
    if(session?.busy)return "Wait for the current change group operation to finish.";
    if(state.intent!=="build")return "";
    if(state.executionSession?.busy || state.executionSession?.planSession?.busy)return "Stop the isolated check before starting another Build.";
    if(session?.storage && session.storage.status!=="saved")return "Resolve change group storage before starting Build.";
    if(group && state.groupRevision && !groupRevisionBlocker())return "";
    if(group)return group.status==="recovery-required"?"Restore the change group checkpoint before starting Build.":group.status==="partially-applied"?"Apply the remaining changes, undo accepted changes, or dismiss this checkpoint before starting Build.":group.status==="applied"?"Undo or dismiss the current change group before starting Build.":"Refine, apply or discard the current change group before starting Build.";
    return "";
  }
  function changeArtifact(proposal, expanded = false) {
    const view = artifacts.proposalState(proposal, proposal.planBasis?artifactFiles():sourceFiles(), state.dirtyPaths, state.running, currentProposalId());
    const id = `proposal/${proposal.id}`;
    const body = el("div");
    body.append(el("p", "", proposal.summary || "Review the source change and its scope."));
    const file = el("div", "artifact-file");
    file.append(icon("source"), el("code", "", proposal.path), el("span", "", "1 file")); body.append(file);
    if(proposal.planBasis?.length){const basis=el("div","plan-source-basis");for(const source of proposal.planBasis)basis.append(el("code","",`${source.path} · ${source.revision.slice(0,7)}`));body.append(contentDetails(`Plan source basis · ${proposal.planBasis.length}`,`${id}:plan-basis`,[basis]));}
    const actions = [];
    if (expanded) {
      body.append(proposalReview(proposal, false, true));
      if (view.superseded) body.querySelector(".proposal-actions")?.remove();
      body.append(verificationArtifact(proposal, true, true));
    } else actions.push(artifactButton(view.superseded ? "Inspect previous proposal" : "Review change", () => openArtifact({kind:"changes", proposalId:proposal.id}), `${id}:review`, true, "arrow"));
    return artifactCard({id, kind:"Code changes", title:proposal.title || "Proposed source change", status:view.status, scope:"1 file", provenance:proposal.origin === "ai" ? "AI interpretation" : "From source · design edit", freshness:view.stale ? "Stale" : proposal.planBasis?.length && view.evidence.status==="unknown" ? "Freshness unknown" : `Baseline ${proposal.baseRevision.slice(0, 7)}`, body, expanded, actions, warnings:[view.reason], open:() => openArtifact({kind:"changes", proposalId:proposal.id})});
  }
  function artifactKey(turn) {return `${state.project?.id}/${state.conversations?.activeId}/${turn.requestId}/${turn.plan?.id || turn.review?.id}`;}
  function artifactFiles() {
    const missing=new Set(state.artifactSourceUnavailable.map(item=>typeof item==="string"?item:item.path)),files=new Map(sourceFiles().map(file=>[file.path,file]));
    for(const file of state.artifactSourceFiles)files.set(file.path,file);
    return [...files.values()].filter(file=>!missing.has(file.path));
  }
  function artifactEvidence(turn) {return artifacts.freshness(turn.context,artifactFiles(),state.dirtyPaths);}
  function editablePlan(turn) {return artifacts.planRevision(turn);}
  function planDigest(value) {return JSON.stringify(artifacts.planValues(value));}
  function planDraft(turn) {
    const key=artifactKey(turn),current=editablePlan(turn);if(!current)return null;
    if(!planDrafts.has(key))planDrafts.set(key,{...artifacts.planValues(current),baseRevision:current.revision,base:planDigest(current),dirty:false});
    return planDrafts.get(key);
  }
  function planDirty(turn) {return Boolean(planDrafts.get(artifactKey(turn))?.dirty);}
  function planConflict(turn) {
    const draft=planDrafts.get(artifactKey(turn)),current=editablePlan(turn);
    const pendingOwnSave=draft?.submitted && state.conversations?.storage?.status!=="saved" && draft.submitted.localDigest===planDigest(draft) && draft.submitted.digest===planDigest(current);
    return Boolean(draft?.dirty && current?.revision!==draft.baseRevision && !pendingOwnSave);
  }
  function safePlanDraftRecord(record) {
    if(!Array.isArray(record) || record.length!==2 || typeof record[0]!=="string" || record[0].length>1024)return null;
    const draft=record[1],text=(value,max)=>typeof value==="string" && value.length<=max;
    if(!draft || !Number.isSafeInteger(draft.baseRevision) || draft.baseRevision<0 || !text(draft.base,65536) || draft.dirty!==true || !text(draft.title,160) || !text(draft.summary,2000) || !Array.isArray(draft.steps) || !draft.steps.length || draft.steps.length>16 || !draft.steps.every(step=>step && text(step.id,200) && text(step.title,160) && text(step.detail,2000) && typeof step.included==="boolean") || ![draft.risks,draft.verification].every(list=>Array.isArray(list) && list.length<=6013 && list.every(item=>typeof item==="string") && list.join("\n").length<=6012) || ![draft.risksInput,draft.verificationInput].every(value=>value===undefined || text(value,6012)))return null;
    return [record[0],{title:draft.title,summary:draft.summary,steps:draft.steps.map(({id,title,detail,included})=>({id,title,detail,included})),risks:[...draft.risks],verification:[...draft.verification],baseRevision:draft.baseRevision,base:draft.base,dirty:true,...(draft.risksInput!==undefined?{risksInput:draft.risksInput}:{}),...(draft.verificationInput!==undefined?{verificationInput:draft.verificationInput}:{})}];
  }
  function persistablePlanDrafts() {
    const pending=persistedPlanDrafts.filter(([key])=>!restoredPlanDrafts.has(key));
    return [...new Map([...pending,...[...planDrafts].filter(([,draft])=>draft.dirty)])].slice(-16).map(safePlanDraftRecord).filter(Boolean);
  }
  function validLocalPlanDraft(saved,original) {
    const text=(value,max)=>typeof value==="string" && value.length<=max;
    return Boolean(saved && typeof saved==="object" && Number.isSafeInteger(saved.baseRevision) && saved.baseRevision>=0 && text(saved.base,65536) && saved.dirty===true && text(saved.title,160) && text(saved.summary,2000) && Array.isArray(saved.steps) && saved.steps.length===original.steps.length && saved.steps.length<=16 && new Set(saved.steps.map(step=>step.id)).size===saved.steps.length && saved.steps.every(step=>original.steps.some(item=>item.id===step.id) && text(step.title,160) && text(step.detail,2000) && typeof step.included==="boolean") && [saved.risks,saved.verification].every(list=>Array.isArray(list) && list.length<=6013 && list.every(item=>typeof item==="string") && list.join("\n").length<=6012) && [saved.risksInput,saved.verificationInput].every(value=>value===undefined || text(value,6012)));
  }
  function syncPlanDrafts() {
    for(const turn of state.turns) {
      if(!turn.plan || !editablePlan(turn))continue;
      const key=artifactKey(turn),current=editablePlan(turn);
      if(!restoredPlanDrafts.has(key)) {
        restoredPlanDrafts.add(key);const saved=persistedPlanDrafts.find(item=>Array.isArray(item) && item[0]===key)?.[1];
        if(!planDrafts.has(key) && validLocalPlanDraft(saved,turn.plan))planDrafts.set(key,{...artifacts.planValues(saved),baseRevision:saved.baseRevision,base:saved.base,dirty:true,...(saved.risksInput!==undefined?{risksInput:saved.risksInput}:{}),...(saved.verificationInput!==undefined?{verificationInput:saved.verificationInput}:{})});
      }
      const draft=planDrafts.get(key);if(!draft)continue;
      const digest=planDigest(draft),ack=draft.submitted && draft.submitted.localDigest===digest && draft.submitted.digest===planDigest(current) && current.revision>draft.submitted.revision;
      if(!draft.dirty || (digest===planDigest(current) || ack) && state.conversations?.storage?.status==="saved"){
        Object.assign(draft,artifacts.planValues(current),{baseRevision:current.revision,base:planDigest(current),dirty:false});delete draft.risksInput;delete draft.verificationInput;delete draft.submitted;
      }
    }
  }
  function planActionBlocked(turn,mutation=false) {
    return !assistantSurface || !state.trusted || state.running || Boolean(pendingPlanAction) || turn.state!=="complete" || state.conversations?.storage?.status!=="saved" || mutation && (Boolean(activeConversation()?.archived) || turn.completedWhileStopping===true);
  }
  function sendPlanAction(turn,action,extra={}) {
    if(planActionBlocked(turn,["revise","prepareBuild"].includes(action)))return;
    const artifact=turn.plan || turn.review,revision=editablePlan(turn)?.revision ?? 0;
    const message={type:"planAction",action,projectId:state.project.id,conversationId:state.conversations.activeId,requestId:turn.requestId,artifactId:artifact.id,expectedRevision:revision,...extra};
    pendingPlanAction={...message};planErrors.delete(artifactKey(turn));
    if(action==="prepareBuild")pendingPlanPreparation={...message,featureId:state.features?.activeId || null};
    vscode.postMessage(message);renderAssistant();
  }
  function artifactFreshnessLabel(evidence) {return evidence.status==="current"?"Matches saved source":evidence.status==="stale"?"Stale":"Freshness unknown";}
  function artifactSourceWarning(turn) {
    const evidence=artifactEvidence(turn);
    return evidence.drafts.length?"Unsaved source changes are excluded. Resolve affected drafts before using exact references or preparing Build.":evidence.status==="stale"?"Saved source changed. This artifact retains its original evidence; create a new request from current source.":evidence.status==="unknown"?"Check source to compare this artifact with the current saved files.":"";
  }
  function artifactCheckButton(turn) {return artifactButton(pendingPlanAction?.artifactId===(turn.plan || turn.review).id && pendingPlanAction.action==="checkSources"?"Checking source…":"Check source",()=>sendPlanAction(turn,"checkSources"),`${artifactKey(turn)}:check`,false,"refresh");}
  function artifactReferences(turn,item,kind) {
    const list=el("div","structured-references"),evidence=artifactEvidence(turn),enabled=evidence.status==="current" && !evidence.drafts.length && !planActionBlocked(turn);
    for(const [index,ref] of item.references.entries()) {
      const control=artifactButton(`${basename(ref.path)}:${ref.line}${ref.endLine>ref.line?`–${ref.endLine}`:""}`,()=>sendPlanAction(turn,"navigate",{[kind==="plan"?"stepId":"findingId"]:item.id,referenceIndex:index}),`${artifactKey(turn)}/${item.id}/reference/${index}`,false,"source");
      control.classList.add("structured-reference");control.disabled=!enabled;control.title=`${ref.path} · saved revision ${ref.revision.slice(0,7)}`;list.append(control);
    }
    if(!item.references.length)list.append(el("p","artifact-boundary","No source reference attached."));return list;
  }
  function planEditControl(turn,draft,label,value,field,max,rows=2,stepId) {
    const wrap=el("label","plan-edit-field",label),input=el(rows===1?"input":"textarea");if(rows!==1)input.rows=rows;input.value=draft[`${field}Input`] ?? value;input.maxLength=max;input.disabled=planActionBlocked(turn,true);input.setAttribute("aria-label",label);input.dataset.designFocus=`${artifactKey(turn)}/edit/${stepId || "plan"}/${field}`;
    input.addEventListener("input",()=>{const owner=stepId?draft.steps.find(step=>step.id===stepId):draft;if(["risks","verification"].includes(field))draft[`${field}Input`]=input.value;owner[field]=["risks","verification"].includes(field)?input.value.split("\n").filter(value=>value.trim()):input.value;draft.dirty=planDigest(draft)!==draft.base;saveView();refreshPlanControls();});wrap.append(input);return wrap;
  }
  function refreshPlanControls() {
    for(const form of document.querySelectorAll(".plan-edit-form")) {
      const turn=state.turns.find(item=>item.requestId===form.dataset.requestId);if(!turn?.plan)continue;const draft=planDraft(turn),conflict=planConflict(turn),valid=artifacts.planDraftValid(draft,turn.plan,byteLength);
      const save=form.querySelector(".plan-save");if(save)save.disabled=planActionBlocked(turn,true) || conflict || !draft.dirty || !valid;
      const status=form.querySelector(".plan-draft-state");if(status)status.textContent=conflict?"A newer plan version is saved. Your draft is preserved; reload it before saving.":!valid?"Check the titles, details, and list limits before saving.":draft.dirty?"Unsaved plan changes":"Saved plan";
    }
    updateAskButton();
  }
  function planEditor(turn) {
    const draft=planDraft(turn),form=el("div","plan-edit-form");form.dataset.requestId=turn.requestId;
    form.append(planEditControl(turn,draft,"Plan title",draft.title,"title",160,1),planEditControl(turn,draft,"Plan summary",draft.summary,"summary",2000,3));
    for(const [index,step] of draft.steps.entries()) {
      const section=el("fieldset","plan-edit-step"),legend=el("legend","",`Step ${index+1}`);section.append(legend);
      const includeLabel=el("label","plan-include"),include=el("input");include.type="checkbox";include.checked=step.included;include.disabled=planActionBlocked(turn,true);include.setAttribute("aria-label",`Include step ${index+1}`);include.dataset.designFocus=`${artifactKey(turn)}/include/${step.id}`;include.addEventListener("change",()=>{step.included=include.checked;draft.dirty=planDigest(draft)!==draft.base;saveView();refreshPlanControls();});includeLabel.append(include,el("span","","Include in plan"));section.append(includeLabel);
      section.append(planEditControl(turn,draft,`Step ${index+1} title`,step.title,"title",160,1,step.id),planEditControl(turn,draft,`Step ${index+1} detail`,step.detail,"detail",2000,3,step.id));
      const actions=el("div","plan-order-actions");for(const [offset,label] of [[-1,"Move up"],[1,"Move down"]]){const move=artifactButton(label,()=>{const target=index+offset;[draft.steps[index],draft.steps[target]]=[draft.steps[target],draft.steps[index]];draft.dirty=planDigest(draft)!==draft.base;saveView();renderAssistant();},`${artifactKey(turn)}/move/${step.id}/${offset}`);move.disabled=planActionBlocked(turn,true) || index+offset<0 || index+offset>=draft.steps.length;move.setAttribute("aria-label",`${label} step ${index+1}`);actions.append(move);}section.append(actions);form.append(section);
    }
    form.append(planEditControl(turn,draft,"Plan risks (one per line, up to 12)",draft.risks.join("\n"),"risks",6012,3),planEditControl(turn,draft,"Suggested checks (one per line, up to 12)",draft.verification.join("\n"),"verification",6012,3));
    const status=el("p","plan-draft-state");status.setAttribute("role","status");form.append(status);
    const actions=el("div","plan-form-actions"),save=artifactButton("Save plan",()=>{
      if(!draft.dirty || planConflict(turn) || !artifacts.planDraftValid(draft,turn.plan,byteLength))return;
      const input=artifacts.planValues(draft);input.title=input.title.trim();input.summary=input.summary.trim();input.steps=input.steps.map(step=>({...step,title:step.title.trim(),detail:step.detail.trim()}));input.risks=input.risks.map(value=>value.trim());input.verification=input.verification.map(value=>value.trim());draft.submitted={revision:draft.baseRevision,digest:planDigest(input),localDigest:planDigest(draft)};sendPlanAction(turn,"revise",{input});
    },`${artifactKey(turn)}:save`,true);save.classList.add("plan-save");save.disabled=planActionBlocked(turn,true) || planConflict(turn) || !draft.dirty || !artifacts.planDraftValid(draft,turn.plan,byteLength);
    const discard=artifactButton(planConflict(turn)?"Reload saved plan":"Discard plan draft",()=>{planDrafts.delete(artifactKey(turn));saveView();renderAssistant();},`${artifactKey(turn)}:discard`);discard.disabled=Boolean(pendingPlanAction);actions.append(save,discard);form.append(actions);return form;
  }
  function structuredList(title,items,key) {const list=el("ul","structured-list");for(const item of items)list.append(el("li","",item));return contentDetails(`${title} · ${items.length}`,key,[list]);}
  function planArtifact(turn,expanded=false,editing=false) {
    const plan=turn.plan,key=artifactKey(turn),latest=editablePlan(turn),version=artifacts.planRevision(turn,planVersions.get(key)) || latest;
    if(!latest)return responseArtifact({...turn,plan:null},expanded);
    const current=version.revision===latest.revision,evidence=artifactEvidence(turn),body=el("div","plan-artifact-body");body.append(el("p","",version.summary));
    if(expanded && turn.planRevisions.length>1){const label=el("label","plan-version-label","Version"),select=el("select");select.setAttribute("aria-label","Plan version");select.dataset.designFocus=`${key}/version`;for(const item of [...turn.planRevisions].reverse()){const option=el("option","",`${item.revision===0?"Original AI plan":`Edited version ${item.revision}`}${item.revision===latest.revision?" · Current":""}`);option.value=String(item.revision);select.append(option);}select.value=String(version.revision);select.addEventListener("change",()=>{planVersions.set(key,Number(select.value));expandedArtifact.edit=false;renderAssistant();});label.append(select);body.append(label);}
    if(editing && current)body.append(planEditor(turn));
    else {
      const steps=el("ol","plan-steps"),selectedId=planSelections.get(key) || version.steps.find(step=>step.included)?.id || version.steps[0].id;
      for(const [index,step] of version.steps.entries()) {
        const row=el("li"),select=artifactButton("",()=>{planSelections.set(key,step.id);renderAssistant();},`${key}/select/${step.id}`);select.className="plan-step-choice";select.setAttribute("aria-pressed",String(step.id===selectedId));select.setAttribute("aria-label",`Select step ${index+1}: ${step.title}`);select.append(el("span","plan-step-number",index+1),el("span","plan-step-title",step.title));if(!step.included)select.append(el("small","","Excluded"));row.append(select);steps.append(row);
      }
      body.append(steps);const step=version.steps.find(step=>step.id===selectedId) || version.steps[0],original=plan.steps.find(item=>item.id===step.id);const detail=el("div","plan-selected-step");detail.append(el("p","",step.detail),artifactReferences(turn,original,"plan"));body.append(detail);
      const eligibility=artifacts.planStepState(turn,step.id,artifactFiles(),state.dirtyPaths),prepare=artifactButton("Prepare in Build",()=>sendPlanAction(turn,"prepareBuild",{stepId:step.id,prepareId:`plan-build-${crypto.randomUUID()}`}),`${key}/prepare`,true,"code");prepare.disabled=!current || planDirty(turn) || !eligibility.canPrepare || planActionBlocked(turn,true);
      if(current)body.append(prepare);const reason=turn.completedWhileStopping?"This plan finished during Stop. It remains readable, but cannot be edited or prepared for Build.":activeConversation()?.archived?"Archived conversations are read-only. Restore this conversation before preparing Build.":!current?"Previous plan version. Choose the current version to prepare Build.":planDirty(turn)?"Save or discard the plan draft before preparing Build.":eligibility.reason;
      if(reason)body.append(el("p","artifact-boundary",reason));else body.append(el("p","artifact-boundary","Prepares one referenced file. Sending and applying remain separate."));
      if(version.risks.length)body.append(structuredList("Risks",version.risks,`${key}/${version.revision}:risks`));if(version.verification.length)body.append(structuredList("Suggested checks · Not run",version.verification,`${key}/${version.revision}:checks`));
    }
    body.append(sourceSnapshots(turn.context,`${key}:sources`));const task=savedTaskContext(turn);if(task)body.append(task);const runtime=runtimeEvidenceHistory(turn);if(runtime)body.append(runtime);
    const actions=[];if(!editing){const check=artifactCheckButton(turn);check.disabled=planActionBlocked(turn);actions.push(check);if(current){const edit=artifactButton("Edit plan",()=>{planVersions.delete(key);openArtifact({kind:"plan",turnId:turn.id,edit:true});},`${key}:edit`);edit.disabled=planActionBlocked(turn,true) || latest.revision>=16;actions.push(edit);}}
    return artifactCard({id:`plan/${plan.id}`,kind:"Plan",title:version.title,status:turn.state==="complete"?`Version ${version.revision}${current?"":" · Previous"}`:"Incomplete plan",scope:`${version.steps.filter(step=>step.included).length} included step${version.steps.filter(step=>step.included).length===1?"":"s"}`,provenance:version.revision?"AI interpretation · Edited by you":"AI interpretation",freshness:artifactFreshnessLabel(evidence),body,actions,expanded,warnings:[turn.completedWhileStopping?"Finished during Stop. The plan may be partial; editing and Build preparation are unavailable.":"",artifactSourceWarning(turn),planDirty(turn)?"Unsaved plan changes are preserved on this device.":"",planErrors.get(key)],open:()=>openArtifact({kind:"plan",turnId:turn.id})});
  }
  function reviewArtifact(turn,expanded=false) {
    const review=turn.review,key=artifactKey(turn),body=el("div","review-artifact-body"),evidence=artifactEvidence(turn);body.append(el("p","",review.summary));
    if(!review.findings.length)body.append(el("p","artifact-boundary","No findings returned. Verification has not run."));
    for(const finding of review.findings){const item=el("article","review-finding");item.append(el("span",`review-severity ${finding.severity}`,`${finding.severity[0].toUpperCase()+finding.severity.slice(1)} priority`),el("h3","",finding.title),el("p","",finding.detail),artifactReferences(turn,finding,"review"));if(finding.suggestion)item.append(contentDetails("Suggested follow-up",`${key}/${finding.id}:suggestion`,[el("p","",finding.suggestion)]));body.append(item);}
    if(review.limitations?.length)body.append(structuredList("Limitations",review.limitations,`${key}:limits`));if(review.verification?.length)body.append(structuredList("Suggested checks · Not run",review.verification,`${key}:checks`));
    body.append(el("p","artifact-boundary","Review of selected saved source. Build, interaction and visual checks have not run."),sourceSnapshots(turn.context,`${key}:sources`));const task=savedTaskContext(turn);if(task)body.append(task);const runtime=runtimeEvidenceHistory(turn);if(runtime)body.append(runtime);
    const check=artifactCheckButton(turn);check.disabled=planActionBlocked(turn);
    return artifactCard({id:`review/${review.id}`,kind:"Source review",title:review.title,status:turn.state==="complete"?"Review ready":"Incomplete review",scope:`${review.findings.length} finding${review.findings.length===1?"":"s"}`,provenance:"AI interpretation",freshness:artifactFreshnessLabel(evidence),body,actions:[check],expanded,warnings:[artifactSourceWarning(turn),planErrors.get(key)],open:()=>openArtifact({kind:"source-review",turnId:turn.id})});
  }
  function preparedPlan() {
    const descriptor=state.planContext;if(!descriptor || descriptor.conversationId!==state.conversations?.activeId)return null;
    const turn=state.turns.find(turn=>turn.requestId===descriptor.requestId && turn.plan?.id===descriptor.artifactId);if(!turn)return null;
    const latest=editablePlan(turn),step=latest?.steps.find(step=>step.id===descriptor.stepId),original=turn.plan.steps.find(step=>step.id===descriptor.stepId);
    return {descriptor,turn,latest,step,original,current:latest?.revision===descriptor.revision && Boolean(step?.included)};
  }
  function planContextBlocker() {
    if(state.intent!=="build" || !state.planContext)return "";const selected=preparedPlan();
    if(!selected?.current)return "The prepared plan changed. Prepare this step again or remove it.";
    if(planDirty(selected.turn))return "Save or discard the plan draft before Build.";
    const eligibility=artifacts.planStepState(selected.turn,selected.step.id,artifactFiles(),state.dirtyPaths);if(eligibility.reason)return eligibility.reason;
    if(state.context.length!==1 || state.context[0]!==eligibility.paths[0])return "This prepared step uses one file. Prepare it again or remove the plan step.";return "";
  }
  function selectedPlanSnapshot() {
    const selected=preparedPlan();if(!selected?.current)return null;return {...selected.descriptor,title:selected.latest.title,summary:selected.latest.summary,step:{title:selected.step.title,detail:selected.step.detail,references:selected.original.references.map(ref=>({...ref}))},verification:[...selected.latest.verification]};
  }
  function planContextCard() {
    if(state.intent!=="build" || !state.planContext)return null;const selected=preparedPlan(),card=el("section","prepared-plan-context");card.setAttribute("aria-label","Selected plan step");
    card.append(el("strong","",selected?.step?.title || "Prepared plan step"),el("p","",selected?.latest?`${selected.latest.title} · version ${state.planContext.revision}`:"This plan is no longer available."));
    if(selected?.original)card.append(el("code","",[...new Set(selected.original.references.map(ref=>ref.path))].join(", ")));
    const actions=el("div","plan-form-actions"),remove=artifactButton("Remove plan step",()=>{state.planContext=null;markAssistantDraftEdited();saveView();renderAssistant();},"plan-context/remove");remove.disabled=state.running;actions.append(remove);if(selected && artifactEvidence(selected.turn).status==="unknown"){const check=artifactCheckButton(selected.turn);check.disabled=planActionBlocked(selected.turn);actions.append(check);}card.append(actions);return card;
  }
  function savedPlanContext(turn) {
    const context=turn.planContext;if(!context)return null;
    return contentDetails("Saved plan step",`request/${turn.requestId}:plan`,[el("strong","",context.title || "Plan step"),el("p","",context.step?.title || ""),el("p","",context.step?.detail || ""),el("p","artifact-boundary",`Historical plan version ${context.revision}. Later plan edits do not change this request.`)],"content-details saved-plan-context");
  }

  function groupRevisionView(descriptor=state.groupRevision) {
    return artifacts.groupRevisionState(descriptor,activeConversation(),state.changeSetSession,state.intent,state.context,sourceFiles(),state.dirtyPaths);
  }
  function groupRevisionBlocker() {
    if(!state.groupRevision)return "";
    if(state.requestRevision || state.planContext)return "Choose one preparation before sending.";
    const view=groupRevisionView();return view.reason || (view.files.reduce((total,file)=>total+byteLength(file.source),0)>65536?"Staged source exceeds 64 KiB. Refine a smaller group.":"");
  }
  function validateRestoredGroupRevision() {
    if(pendingGroupRevision && (!matchingAssistantIdentity(pendingGroupRevision,assistantIdentity()) || state.changeSetSession?.current?.id!==pendingGroupRevision.groupId || state.changeSetSession.current.revision!==pendingGroupRevision.expectedGroupRevision || state.changeSetSession.current.status!=="proposed")){
      pendingGroupRevision=null;state.groupRevisionNotice="The group changed while it was being prepared. Your draft is preserved; prepare the current group again.";
    }
    if(state.groupRevision && !groupRevisionView().valid){state.groupRevision=null;state.groupRevisionNotice="The saved group refinement could not be restored. Your draft is now a new request.";}
  }
  function groupPreparationReason(group) {
    if(!assistantSurface)return "Open Assistant to refine a staged group.";
    if(pendingGroupRevision)return "Preparing this group…";
    if(pendingRequestRevision || pendingPlanAction || state.historyAction)return "Wait for the current preparation to finish.";
    const view=changeSetView(group);if(view.acceptance.value)return "Use whole proposal before refining this group.";if(!view.canApply)return view.reason || "Prepare a current staged group with unchanged source before refining.";
    if(artifacts.groupVersionChain(group,state.changeSetSession).length>=8)return "This group has reached its eight retained versions. Start a new group after reviewing it.";
    if(state.changeSetSession?.versions?.length>=64)return "Retained group storage is full. Existing snapshots are preserved.";
    const owner=changeSetOwner(group),evidence=artifacts.freshness(owner?.turn.context || [],sourceFiles(),state.dirtyPaths);
    if(evidence.status==="stale" || evidence.drafts.length)return "Resolve changed source and affected drafts before refining this group.";
    return "";
  }
  function prepareGroupRevision(group) {
    if(groupPreparationReason(group))return;const identity=assistantIdentity(),owner=changeSetOwner(group);if(!identity?.conversationId || !owner)return;
    pendingPlanPreparation=null;groupRevisionErrors.delete(group.id);
    pendingGroupRevision={...identity,requestId:owner.turn.requestId,groupId:group.id,expectedGroupRevision:group.revision,prepareId:`refine-group-${crypto.randomUUID()}`,generation:assistantDraftGeneration};
    const {generation,...message}=pendingGroupRevision;vscode.postMessage({type:"groupRevisionAction",action:"prepare",...message});renderAssistant();
  }
  function groupSharedSource(files,key,label="Staged source to share") {
    const content=[];for(const file of files){const block=el("div","context-source");block.append(el("div","context-source-path",`${file.path} · ${file.origin==="staged"?"Staged source":`Saved support · ${file.revision?.slice(0,7) || ""}`}`),el("pre","",file.source));content.push(block);}
    return contentDetails(`${label} · ${files.length} files`,key,content,"content-details group-shared-source");
  }
  function groupRevisionCard() {
    if(!state.groupRevision)return null;const view=groupRevisionView(),card=el("section","prepared-plan-context group-revision-context");card.setAttribute("aria-label","Refining a staged group");
    card.append(el("strong","","Refining a staged group"),el("p","",view.group?.title || "Original group unavailable"),el("p","artifact-boundary","Shares staged source and saved support files. Earlier chat and tool output stay local. A new proposal keeps the current group until it is ready."));
    if(view.files.length)card.append(groupSharedSource(view.files,"group-revision/shared"));if(view.reason)card.append(el("p","request-revision-warning",view.reason));
    const actions=el("div","plan-form-actions");if(view.group)actions.append(artifactButton("Review current group",()=>openArtifact({kind:"change-set",changeSetId:view.group.id}),"group-revision/review"));
    const remove=artifactButton("Remove group refinement",()=>{detachRequestRevision();markAssistantDraftEdited();saveView();renderAssistant();},"group-revision/remove");remove.disabled=state.running;actions.append(remove);card.append(actions);return card;
  }
  function savedGroupRevision(turn) {
    const descriptor=validateGroupRevision(turn.groupRevision);if(!descriptor)return null;
    const view=artifacts.groupRevisionSources(descriptor,activeConversation()),section=el("section","saved-group-revision");section.setAttribute("aria-label","Group refinement context");section.append(el("p","request-revision-lineage","Refined from staged source · earlier chat and tool output not included"));
    if(view.valid){section.append(artifactButton("View original group",()=>openArtifact({kind:"change-set",changeSetId:descriptor.groupId}),`request/${turn.requestId}:original-group`),groupSharedSource(view.files,`request/${turn.requestId}:group-source`,"Source shared with this request"));}
    else section.append(el("p","artifact-boundary","The original staged source is unavailable. Do not treat the saved baseline as the source shared with this request."));
    section.append(sourceSnapshots(turn.context,`request/${turn.requestId}:disk-basis`,false,"Original saved source basis"));
    const session=state.changeSetSession,selected=session?.current?.id===turn.changeSet?.id,retained=selected || session?.versions?.some(item=>item.group?.id===turn.changeSet?.id);
    if(turn.state==="complete" && turn.changeSet && session && !state.running && !session.busy){
      const storageUnconfirmed=["error","unavailable"].includes(session.storage?.status);
      const message=storageUnconfirmed && selected?"This version was selected, but its local durability is unconfirmed. Retry change storage before using it."
        :!retained?storageUnconfirmed?"Staging could not be confirmed. Retry change storage to check the saved group state.":session.storage?.status==="saved"?"Proposal saved, but it did not become the current version. The previous group is preserved.":"":"";
      if(message){const notice=el("p","group-promotion-notice",message);notice.setAttribute("role","status");section.append(notice);}
    }
    if(["stopped","failed","interrupted"].includes(turn.state) && state.changeSetSession?.current?.id===descriptor.groupId)section.append(el("p","artifact-boundary","This refinement did not replace the current staged group."));return section;
  }

  function investigationDescriptor(value) {return {version:1,id:value.id,digest:value.digest};}
  function clearSourceInvestigation(notify=true) {
    const pending=pendingSourceInvestigation,result=state.investigationContext,identity=pending || assistantIdentity();
    if(notify && identity && (pending || result))vscode.postMessage({type:"sourceInvestigationAction",action:"remove",projectId:identity.projectId,featureId:identity.featureId,conversationId:identity.conversationId,featureRevision:pending?.featureRevision ?? result.featureRevision,prepareId:pending?.prepareId || `remove-investigation-${crypto.randomUUID()}`,...(!pending && result?{sourceInvestigation:investigationDescriptor(result)}:{})});
    pendingSourceInvestigation=null;state.investigationContext=null;state.investigationRefreshed=false;state.investigationNotice="";
  }
  function investigationView() {
    return artifacts.sourceInvestigationState(state.investigationContext,state.sourceInvestigation,{projectId:state.project?.id,featureId:state.features?.activeId,featureRevision:state.features?.revision,intent:state.intent,paths:state.context,files:sourceFiles(),dirtyPaths:state.dirtyPaths,refreshed:state.investigationRefreshed,archived:activeConversation()?.archived,historyReady:state.conversations?.storage?.status==="saved",running:state.running});
  }
  function investigationBlocker() {return pendingSourceInvestigation?"Reading saved-source relationships…":state.investigationContext?investigationView().reason:"";}
  function prepareSourceInvestigation(offer,refresh=false) {
    const identity=assistantIdentity();
    if(!assistantSurface || !identity || !matchingAssistantIdentity(offer,identity) || offer.featureRevision!==state.features?.revision || !validContextPath(offer.anchorPath) || !state.project.files.some(file=>file.path===offer.anchorPath) || !identity.featureId || state.running || state.historyAction || activeConversation()?.archived || state.conversations.storage?.status!=="saved" || pendingSourceInvestigation)return;
    if(!refresh && (typeof offer.snapshotId!=="string" || !offer.snapshotId))return;
    const prepareId=`source-investigation-${crypto.randomUUID()}`;
    pendingSourceInvestigation={...identity,featureRevision:offer.featureRevision,anchorPath:offer.anchorPath,...(!refresh?{snapshotId:offer.snapshotId}:{}),prepareId,generation:assistantDraftGeneration};state.investigationNotice="";
    const {generation,...request}=pendingSourceInvestigation;vscode.postMessage({type:"sourceInvestigationAction",action:refresh?"refresh":"prepare",...request});renderAssistant();
  }
  function sourceInvestigationProjection(value) {
    const ref=({revision,...item})=>item;let index=0;
    return {anchorPath:value.anchor.path,edges:value.edges.map(({id,...item})=>({...item,id:`I${++index}`,from:ref(item.from),to:ref(item.to)})),requests:value.requests.map(({id,...item})=>({...item,id:`I${++index}`,source:ref(item.source)})),boundaries:value.boundaries.map(item=>({...item})),counts:{...value.counts},truncated:value.truncated};
  }
  function sourceInvestigationEvidence(value,key,historical=false,shared=true) {
    const projection=sourceInvestigationProjection(value),body=el("div","source-investigation-evidence");body.tabIndex=0;body.setAttribute("aria-label","Relationship evidence");body.dataset.artifactFocus=`${key}:body`;
    body.append(el("p","artifact-boundary",`${projection.edges.length} of ${projection.counts.edges} relationships · ${projection.requests.length} of ${projection.counts.requests} request sites`));
    const reference=ref=>`${ref.path}:${ref.line}:${ref.column}${ref.label?` · ${ref.label}`:""}`;
    if(projection.edges.length){const list=el("ol","source-investigation-list");list.setAttribute("aria-label","Source relationships");for(const edge of projection.edges){const item=el("li");item.append(el("strong","",`${edge.id} · ${edge.kind} · From source`),el("p","",reference(edge.from)),el("p","",`→ ${reference(edge.to)}`));if(edge.detail)item.append(el("p","",edge.detail));list.append(item);}body.append(list);}
    if(projection.requests.length){const list=el("ol","source-investigation-list");list.setAttribute("aria-label","Request sites in source");for(const request of projection.requests){const item=el("li");item.append(el("strong","",`${request.id} · ${request.method || "Method unknown"} · ${request.urlKind==="dynamic"?"Dynamic URL":request.url || "URL unknown"}`),el("p","",reference(request.source)),el("p","artifact-boundary",`${request.urlKind} URL · From source`));list.append(item);}body.append(list);}
    if(!projection.edges.length && !projection.requests.length)body.append(el("p","artifact-boundary",projection.truncated?"No supported relationships are included in this bounded result.":"No supported relationships or request sites were found in this saved source."));
    if(projection.truncated)body.append(el("p","request-revision-warning","This result is incomplete. More relationships may exist outside the analysis limits."));
    const limits=el("ul","source-investigation-limits");for(const boundary of projection.boundaries)limits.append(el("li","",`${boundary.kind} · ${boundary.detail}`));body.append(limits);
    const json=el("pre","source-investigation-json",JSON.stringify(projection,null,2));body.append(contentDetails("Exact evidence JSON",`${key}:json`,[json]));
    return contentDetails(historical?shared?"Relationship evidence shared":"Relationship evidence prepared":"Relationship evidence to share",`${key}:evidence`,[body],"content-details source-investigation-details");
  }
  function sourceInvestigationCard() {
    const value=state.investigationContext;if(!value && !pendingSourceInvestigation && !state.investigationNotice)return null;
    const card=el("section","prepared-plan-context source-investigation");card.setAttribute("aria-label","Source investigation");card.setAttribute("aria-busy",String(Boolean(pendingSourceInvestigation)));card.append(el("strong","","Source investigation"));
    if(value){card.append(el("p","source-investigation-anchor",value.anchor.path),el("p","artifact-boundary","Selected file and relationship evidence will be shared. Related file contents are not included."),sourceInvestigationEvidence(value,`investigation/${value.id}`));const view=investigationView();if(view.reason)card.append(el("p","request-revision-warning",view.reason));card.append(contentDetails("Investigation details",`investigation/${value.id}:identity`,[el("p","artifact-boundary",`Saved revision ${value.anchor.revision} · ${formatHistoryTime(value.createdAt)}`),el("code","execution-identity",value.id),el("p","artifact-boundary","Investigation identity and source manifest stay local.")]));}
    if(pendingSourceInvestigation)card.append(el("p","artifact-boundary","Reading saved-source relationships… No AI request has been sent."));
    if(state.investigationNotice){const notice=el("p","request-revision-warning",state.investigationNotice);notice.setAttribute("role","status");card.append(notice);}
    const actions=el("div","plan-form-actions");
    if(value){const refresh=artifactButton("Refresh investigation",()=>prepareSourceInvestigation({...assistantIdentity(),featureRevision:state.features?.revision,anchorPath:value.anchor.path},true),"investigation/refresh");refresh.disabled=Boolean(pendingSourceInvestigation) || state.running || state.historyAction || activeConversation()?.archived || state.features?.activeId!==value.featureId || !state.project?.files.some(file=>file.path===value.anchor.path);actions.append(refresh);}
    const remove=artifactButton("Remove investigation",()=>{clearSourceInvestigation();markAssistantDraftEdited();saveView();renderAssistant();},"investigation/remove");remove.disabled=state.running;actions.append(remove);card.append(actions);return card;
  }
  function savedSourceInvestigation(turn) {
    const value=artifacts.sourceInvestigationSnapshot(turn.sourceInvestigation);if(!value)return null;
    const shared=turn.started===true,box=el("section","saved-source-investigation");box.setAttribute("aria-label",shared?"Shared source investigation":"Prepared source investigation");box.append(el("p","request-revision-lineage",shared?"Saved source investigation · evidence shared with this request":"Saved source investigation · prepared for this request"),el("p","artifact-boundary","Historical result. Static source references do not establish runtime behavior."),sourceInvestigationEvidence(value,`request/${turn.requestId}:investigation`,true,shared));return box;
  }
  function continuationDescriptor(value) {return {version:1,conversationId:value.conversationId,rootRequestId:value.rootRequestId,parentRequestId:value.parentRequestId,digest:value.digest};}
  function clearContinuation(notify=true) {
    const pending=pendingContinuation,value=state.continuationContext,identity=pending || assistantIdentity();
    if(notify && identity && (pending || value))vscode.postMessage({type:"investigationContinuationAction",action:"remove",projectId:identity.projectId,featureId:identity.featureId,featureRevision:pending?.featureRevision ?? state.features?.revision,conversationId:identity.conversationId,requestId:pending?.requestId || value.parentRequestId,prepareId:pending?.prepareId || `remove-continuation-${crypto.randomUUID()}`,...(!pending && value?{investigationContinuation:continuationDescriptor(value)}:{})});
    pendingContinuation=null;state.continuationContext=null;state.continuationRefreshed=false;state.continuationNotice="";
  }
  function continuationView() {
    return artifacts.investigationContinuationState(state.continuationContext,activeConversation(),state.investigationContinuation,{projectId:state.project?.id,featureId:state.features?.activeId,featureRevision:state.features?.revision,intent:state.intent,paths:state.context,files:sourceFiles(),dirtyPaths:state.dirtyPaths,refreshed:state.continuationRefreshed,historyReady:state.conversations?.storage?.status==="saved",running:state.running});
  }
  function continuationBlocker() {return pendingContinuation?"Preparing the investigation checkpoint…":state.continuationContext?continuationView().reason:"";}
  function continuationActionView(turn) {
    const chat=activeConversation(),chain=artifacts.investigationChain(chat,turn.investigationContext?.rootRequestId || turn.requestId),current=chain.valid && chain.latestRequestId===turn.requestId;
    const result=turn.investigationAttempts?.find(attempt=>attempt.status==="complete")?.result || turn.investigationContext?.result || turn.sourceInvestigation;
    const refs=result?[result.anchor,...result.edges.flatMap(edge=>[edge.from,edge.to]),...result.requests.map(item=>item.source)]:[],files=sourceFiles(),dirty=refs.some(ref=>state.dirtyPaths.includes(ref.path)),changed=refs.some(ref=>files.some(file=>file.path===ref.path && file.revision!==ref.revision));
    const identity=assistantIdentity(),busy=state.investigationContinuation?.busy,ownedBusy=Boolean(busy && chat && busy.conversationId===chat.id && busy.requestId===turn.requestId && busy.decisionId===turn.investigationDecision?.id);
    const owner=Boolean(identity && identity.conversationId && result && result.projectId===identity.projectId && result.featureId===identity.featureId && chat?.turns.some(item=>item.requestId===turn.requestId));
    const common=!owner?"Open this investigation in its original project, feature and conversation.":state.conversations?.storage?.status!=="saved"?"Save conversation history before continuing.":state.running || busy?"Finish or stop the active step first.":pendingContinuation || pendingContinuationAction?"Wait for the current checkpoint action.":"";
    const sourceReason=result?.featureRevision!==state.features?.revision?"The feature changed. End this chain and start a new source investigation.":dirty?"Resolve the affected source drafts before sharing saved evidence.":changed?"Saved source changed. End this chain and start a new source investigation.":"";
    return {chain,current,result,ownedBusy,busy,reason:common || sourceReason || (!current?"Continue from the latest checkpoint.":chain.reason),canPrepare:current && chain.canContinue && !common && !sourceReason,canRun:current && (chain.canRun || chain.canRetryTool) && !common && !sourceReason,canEnd:current && chain.canEnd && owner && !common,canStop:Boolean(ownedBusy && identity && state.trusted)};
  }
  function continuationAction(turn,action) {
    const view=continuationActionView(turn),identity=assistantIdentity();if(!identity || !({prepare:view.canPrepare,run:view.canRun,stop:view.canStop,end:view.canEnd})[action])return;
    const prepareId=`continue-investigation-${crypto.randomUUID()}`,request={type:"investigationContinuationAction",action,...identity,featureRevision:state.features.revision,requestId:turn.requestId,prepareId,...(action==="run"?{decisionId:turn.investigationDecision.id}:action==="stop"?{attemptId:view.busy.attemptId}:action==="end"?{rootRequestId:view.chain.rootRequestId}:{})};
    if(action==="prepare")pendingContinuation={...request,generation:assistantDraftGeneration};else if(action!=="stop")pendingContinuationAction={...request,generation:assistantDraftGeneration};continuationErrors.delete(turn.requestId);state.continuationNotice="";vscode.postMessage(request);renderAssistant();
  }
  function continuationProjection(value) {
    return {goal:value.goal,previousExplanation:{kind:value.previousExplanation.kind,text:value.previousExplanation.text},sourceInvestigation:sourceInvestigationProjection(value.result),availableTargets:value.targets.map(({revision,...target})=>target),budget:{...value.budget}};
  }
  function continuationDisclosure(value,key,historical=false,shared=true) {
    const body=el("div","continuation-evidence");body.tabIndex=0;body.dataset.artifactFocus=`${key}:body`;body.setAttribute("aria-label","Continuation evidence");
    body.append(el("strong","","Original question"),el("p","",value.goal),el("strong","",`Previous ${value.previousExplanation.kind==="answer"?"answer":"decision"} · AI interpretation`),el("pre","continuation-explanation",value.previousExplanation.text),sourceInvestigationEvidence(value.result,`${key}:source`,historical,shared));
    if(value.targets.length){const list=el("ul","continuation-targets");for(const target of value.targets)list.append(el("li","",`${target.id} · ${target.path} · ${target.evidenceIds.join(", ")}`));body.append(el("strong","","Available local targets"),list);}else body.append(el("p","artifact-boundary","No further local targets are available. This decision must finish."));
    body.append(el("p","artifact-boundary",`AI attempt ${value.budget.modelStep} of 3 · ${value.budget.toolsUsed} of 2 local attempts used`),contentDetails("Exact continuation JSON",`${key}:json`,[el("pre","continuation-context-json",JSON.stringify(continuationProjection(value),null,2))]));
    return contentDetails(historical?shared?"Continuation context shared":"Continuation context prepared":"Continuation context to share",`${key}:disclosure`,[body],"content-details continuation-details");
  }
  function continuationContextCard() {
    const value=state.continuationContext;if(!value && !pendingContinuation && !state.continuationNotice)return null;
    const card=el("section","prepared-plan-context source-investigation continuation-context");card.setAttribute("aria-label","Continuing investigation");card.setAttribute("aria-busy",String(Boolean(pendingContinuation)));card.append(el("strong","","Continuing investigation"));
    if(value){card.append(el("p","source-investigation-anchor",value.result.anchor.path),el("p","artifact-boundary",`AI attempt ${value.budget.modelStep} of 3 · ${value.budget.toolsUsed} of 2 local attempts used`),el("p","artifact-boundary","Shares the selected file, disclosed result, original question and one prior explanation. Other chat and related file contents are not included."),continuationDisclosure(value,`continuation/${value.digest}`));const reason=continuationView().reason;if(reason)card.append(el("p","request-revision-warning",reason));}
    if(pendingContinuation)card.append(el("p","artifact-boundary","Preparing the saved checkpoint. No AI request or local investigation has started."));
    if(state.continuationNotice){const notice=el("p","request-revision-warning",state.continuationNotice);notice.setAttribute("role","status");card.append(notice);}
    const actions=el("div","plan-form-actions");if(value){const parent=state.turns.find(turn=>turn.requestId===value.parentRequestId),refresh=artifactButton("Refresh checkpoint",()=>parent && continuationAction(parent,"prepare"),"continuation/refresh");refresh.disabled=!parent || !continuationActionView(parent).canPrepare;actions.append(refresh);}
    const remove=artifactButton("Remove continuation",()=>{clearContinuation();markAssistantDraftEdited();saveView();renderAssistant();},"continuation/remove");remove.disabled=state.running;actions.append(remove);card.append(actions);return card;
  }
  function savedContinuationContext(turn) {
    const value=artifacts.investigationContextSnapshot(turn.investigationContext);if(!value)return null;
    const shared=turn.started===true,box=el("section","saved-continuation-context");box.setAttribute("aria-label",shared?"Shared continuation context":"Prepared continuation context");box.append(el("p","request-revision-lineage",`Investigation AI attempt ${value.budget.modelStep} of 3 · ${shared?"disclosed context shared":"prepared for this request"}`),continuationDisclosure(value,`continuation-request/${turn.requestId}`,true,shared));return box;
  }
  function appendContinuationActions(turn,actions,key) {
    const view=continuationActionView(turn);if(!view.chain.valid)return;
    if(view.current && view.chain.canContinue){const label=turn.sourceInvestigation?"Continue investigation":["failed","stopped","interrupted"].includes(turn.state)?"Retry decision":"Share result",prepare=artifactButton(label,()=>continuationAction(turn,"prepare"),`${key}:continue`,true);prepare.disabled=!view.canPrepare;if(view.reason)prepare.title=view.reason;actions.push(prepare);}
    if(view.current && view.chain.canEnd){const end=artifactButton("End investigation",()=>continuationAction(turn,"end"),`${key}:end`);end.disabled=!view.canEnd;actions.push(end);}
  }
  function investigationDecisionArtifact(turn) {
    const decision=turn.investigationDecision,context=artifacts.investigationContextSnapshot(turn.investigationContext);if(!context || !artifacts.investigationDecisionValid(decision,context))return responseArtifact(turn);
    const key=`investigation-decision/${decision.id}`,view=continuationActionView(turn),body=el("div","investigation-decision-body"),action=decision.decision,complete=turn.state==="complete" && !turn.completedWhileStopping;
    body.append(el("p","",decision.summary));if(action.kind==="investigate")body.append(el("strong","continuation-target",action.target.path),el("p","",action.reason),el("p","artifact-boundary",`Source evidence · ${action.target.evidenceIds.join(", ")}`));else body.append(el("p","",action.conclusion));
    if(decision.limitations.length){const list=el("ul");for(const limitation of decision.limitations)list.append(el("li","",limitation));body.append(contentDetails("Investigation limits",`${key}:limits`,[list]));}
    for(const [index,attempt] of (turn.investigationAttempts || []).entries()){
      const box=el("section","continuation-local-result");box.setAttribute("aria-label","Local investigation result");box.dataset.attemptId=attempt.id;const result=artifacts.sourceInvestigationSnapshot(attempt.result),sharedBy=result && activeConversation()?.turns.find(item=>item.started && item.investigationContext?.parentRequestId===turn.requestId && item.investigationContext.result.id===result.id && item.investigationContext.result.digest===result.digest);
      box.append(el("strong","",`Local attempt ${index+1} · ${({running:view.ownedBusy?"Running":"Outcome not saved",complete:"Complete",failed:"Failed",stopped:"Stopped",interrupted:"Interrupted"})[attempt.status] || "Unavailable"}`));if(attempt.reason)box.append(el("p","artifact-boundary",attempt.reason));
      if(result){box.append(el("p","artifact-boundary",sharedBy?`Shared with decision ${sharedBy.investigationContext.budget.modelStep}`:"Not shared"),el("p","continuation-target",result.anchor.path),sourceInvestigationEvidence(result,`${key}:attempt:${attempt.id}`,Boolean(sharedBy)));}body.append(box);
    }
    const actions=[];if(view.canStop){actions.push(artifactButton("Stop investigation",()=>continuationAction(turn,"stop"),`${key}:stop`,false,"stop"));}
    else if(complete && view.current && (view.chain.canRun || view.chain.canRetryTool)){const run=artifactButton(view.chain.canRetryTool?"Retry investigation":"Run investigation",()=>continuationAction(turn,"run"),`${key}:run`,true);run.disabled=!view.canRun;actions.push(run);}
    appendContinuationActions(turn,actions,key);
    const status=!complete?"Incomplete decision":view.ownedBusy?"Investigating locally":view.chain.finished?"Finished":view.chain.root?.investigationEnded?"Ended":!view.current?"Previous checkpoint":turn.investigationAttempts?.some(attempt=>attempt.status==="complete")?"Result ready":view.chain.ended?"Budget exhausted":"Decision needed";
    const chainGuidance=view.reason===view.chain.reason;
    if(view.current && chainGuidance && view.chain.reason && !view.chain.ended && !view.canRun && !view.canStop)body.append(el("p","artifact-boundary",view.chain.reason));
    return artifactCard({id:key,kind:"Investigation checkpoint",title:decision.title,status,scope:view.chain.valid?`${view.chain.modelUsed} of 3 model attempts · ${view.chain.toolUsed} of 2 local attempts`:"",provenance:"AI interpretation",freshness:"Historical investigation",body,actions,warnings:[continuationErrors.get(turn.requestId),view.current && !view.canStop && !chainGuidance?view.reason:"",!complete?"Partial model output cannot authorize a local investigation.":""]});
  }
  function checkContextView(descriptor=state.checkContext) {
    return artifacts.checkContextState(descriptor,activeConversation(),state.changeSetSession,state.executionSession,state.intent,state.context,sourceFiles(),state.dirtyPaths);
  }
  function checkContextBlocker() {return state.checkContext?checkContextView().reason:"";}
  function validateRestoredCheckContext() {
    if(pendingCheckSuggestion && (!matchingAssistantIdentity(pendingCheckSuggestion,assistantIdentity()) || state.changeSetSession?.current?.id!==pendingCheckSuggestion.changeSetId || state.changeSetSession.current.revision!==pendingCheckSuggestion.expectedGroupRevision)){
      pendingCheckSuggestion=null;state.checkContextNotice="The staged group changed during preparation. Your draft is preserved; prepare Suggest checks again.";
    }
    if(state.checkContext && !checkContextView().valid){state.checkContext=null;state.checkContextNotice="The saved check request could not be restored. Your draft is now a new request.";}
  }
  function checkPreparationReason(group) {
    if(!assistantSurface || !state.trusted)return "Open the trusted project in Assistant to suggest checks.";
    if(state.running || state.historyAction || pendingPlanAction || pendingRequestRevision || pendingGroupRevision || pendingCheckDecision)return "Finish the current operation before preparing checks.";
    if(pendingCheckSuggestion)return "Preparing supported checks…";
    const owner=changeSetOwner(group),view=checkPlanView(group);
    if(!owner || owner.turn.state!=="complete" || owner.turn.completedWhileStopping || owner.conversation.archived || owner.conversation.id!==state.conversations?.activeId)return "Open this group in its active, completed conversation.";
    if(!view.canCreate)return view.reason || executionView(group).reason || "Prepare a current workspace with supported checks first.";
    return "";
  }
  function prepareCheckSuggestion(group) {
    if(checkPreparationReason(group))return;const identity=assistantIdentity(),owner=changeSetOwner(group),record=state.executionSession.current;
    if(!identity?.conversationId || !owner)return;
    const prepareId=`suggest-checks-${crypto.randomUUID()}`;
    pendingCheckSuggestion={...identity,prepareId,requestId:owner.turn.requestId,changeSetId:group.id,expectedGroupRevision:group.revision,executionId:record.id,expectedExecutionRevision:record.revision,groupDigest:record.groupDigest,snapshotRevision:record.snapshotRevision,tasks:record.tasks.map(({id,label})=>({id,label})),generation:assistantDraftGeneration};
    checkSuggestionErrors.delete(`group/${group.id}`);
    vscode.postMessage({type:"checkSuggestionAction",action:"prepare",...identity,prepareId,requestId:owner.turn.requestId,changeSetId:group.id,expectedGroupRevision:group.revision,executionId:record.id,expectedExecutionRevision:record.revision});renderAssistant();
  }
  function checkContextCard() {
    if(!state.checkContext)return null;const view=checkContextView(),card=el("section","prepared-plan-context check-context");card.setAttribute("aria-label","Planning checks");
    card.append(el("strong","","Planning checks"),el("p","",view.group?.title || "Original group unavailable"),el("p","artifact-boundary","Shares staged source, saved support files, and supported check names. Earlier chat and tool output stay local. Sending, saving a plan, and running are separate."));
    card.append(el("p","artifact-boundary",`Supported checks · ${state.checkContext.tasks.map(task=>task.label).join(" · ")}`));
    if(view.files.length)card.append(groupSharedSource(view.files,"check-context/shared"));if(view.reason)card.append(el("p","request-revision-warning",view.reason));
    const actions=el("div","plan-form-actions");if(view.group)actions.append(artifactButton("Review staged group",()=>openArtifact({kind:"change-set",changeSetId:view.group.id}),"check-context/review"));
    const remove=artifactButton("Remove check context",()=>{detachRequestRevision();markAssistantDraftEdited();saveView();renderAssistant();},"check-context/remove");remove.disabled=state.running;actions.append(remove);card.append(actions);return card;
  }
  function savedCheckContext(turn) {
    const descriptor=validateCheckContext(turn.checkContext);if(!descriptor)return null;
    const shared=artifacts.groupRevisionSources(descriptor,activeConversation()),box=el("section","saved-check-context");box.setAttribute("aria-label","Check suggestion context");
    box.append(el("p","request-revision-lineage","Planned from staged source · earlier chat and tool output not included"));
    if(shared.valid)box.append(groupSharedSource(shared.files,`check-request/${turn.requestId}:shared`,"Source shared with this request"));else box.append(el("p","artifact-boundary","Original staged source is unavailable. The saved baseline is not the source shared with this request."));
    box.append(contentDetails("Supported checks shared",`check-request/${turn.requestId}:catalog`,[el("p","artifact-boundary",descriptor.tasks.map(task=>task.label).join(" · "))]),sourceSnapshots(turn.context,`check-request/${turn.requestId}:basis`,false,"Original saved source basis"));return box;
  }
  function safeCheckSuggestionDraft(record) {
    if(!Array.isArray(record) || record.length!==2 || typeof record[0]!=="string" || record[0].length>1024)return null;const value=record[1];
    if(!value || value.version!==1 || !validAssistantIdentity(value.groupId) || !Number.isSafeInteger(value.groupRevision) || value.groupRevision<0 || ![value.groupDigest,value.snapshotRevision].every(hash=>typeof hash==="string" && /^[a-f0-9]{64}$/.test(hash)) || !Array.isArray(value.tasks) || !value.tasks.length || value.tasks.length>2 || value.tasks.some(task=>!task || !["node:test","typescript:check"].includes(task.id) || typeof task.label!=="string" || !task.label.length || task.label.length>160) || !Array.isArray(value.taskIds) || value.taskIds.length>2 || new Set(value.taskIds).size!==value.taskIds.length || value.taskIds.some(id=>!value.tasks.some(task=>task.id===id)))return null;
    return [record[0],{version:1,groupId:value.groupId,groupRevision:value.groupRevision,groupDigest:value.groupDigest,snapshotRevision:value.snapshotRevision,tasks:value.tasks.map(({id,label})=>({id,label})),taskIds:[...value.taskIds]}];
  }
  function checkSuggestionKey(turn) {return `${state.project?.id}/${state.conversations?.activeId}/${turn.requestId}/${turn.checkSuggestion?.id}`;}
  function checkSuggestionSelection(turn) {
    const saved=checkSuggestionDrafts.get(checkSuggestionKey(turn)),basis=turn.checkContext;
    if(saved && basis && ["groupId","groupRevision","groupDigest","snapshotRevision"].every(key=>saved[key]===basis[key]) && JSON.stringify(saved.tasks)===JSON.stringify(basis.tasks))return [...saved.taskIds];
    return (turn.checkSuggestion?.checks || []).map(check=>check.taskId);
  }
  function setCheckSuggestionSelection(turn,taskIds) {
    const context=turn.checkContext;checkSuggestionDrafts.set(checkSuggestionKey(turn),{version:1,groupId:context.groupId,groupRevision:context.groupRevision,groupDigest:context.groupDigest,snapshotRevision:context.snapshotRevision,tasks:context.tasks.map(({id,label})=>({id,label})),taskIds});saveView();renderAssistant();
  }
  function checkSuggestionView(turn) {
    return artifacts.checkSuggestionState(turn,activeConversation(),state.changeSetSession,state.executionSession,artifactFiles(),state.dirtyPaths,{taskIds:checkSuggestionSelection(turn),trusted:state.trusted,running:state.running,currentConversation:activeConversation()?.turns.some(item=>item.requestId===turn.requestId && item.checkSuggestion?.id===turn.checkSuggestion?.id),historyReady:state.conversations?.storage?.status==="saved"});
  }
  function checkSuggestionAction(turn,action) {
    const view=checkSuggestionView(turn);if(!view || pendingCheckDecision || !({save:view.canSave,dismiss:view.canDismiss,open:view.canOpen})[action])return;
    const identity=assistantIdentity();if(!identity?.conversationId)return;
    const record=state.executionSession?.current,context=turn.checkContext;
    const message={type:"checkSuggestionAction",action,projectId:identity.projectId,conversationId:identity.conversationId,requestId:turn.requestId,artifactId:turn.checkSuggestion.id,...(action==="save"?{changeSetId:context.groupId,expectedGroupRevision:context.groupRevision,executionId:record.id,expectedExecutionRevision:record.revision,taskIds:view.taskIds}:{})};
    pendingCheckDecision={...message,featureId:identity.featureId};checkSuggestionErrors.delete(checkSuggestionKey(turn));vscode.postMessage(message);renderAssistant();
  }
  function checkSuggestionArtifact(turn,expanded=false,editing=false) {
    const suggestion=turn.checkSuggestion,key=`check-suggestion/${suggestion.id}`,view=checkSuggestionView(turn),context=turn.checkContext,body=el("div","check-suggestion-body"),selected=view.accepted?view.accepted.steps.map(step=>step.task.id):view.taskIds;
    body.append(el("p","",suggestion.summary));
    if(!suggestion.checks.length)body.append(el("p","artifact-boundary","The AI recommended no supported checks. Review its limitations or choose checks yourself."));
    const changed=JSON.stringify(selected)!==JSON.stringify(suggestion.checks.map(check=>check.taskId));
    if(changed)body.append(el("p","artifact-boundary","Check selection edited by you. The original AI rationale is preserved."));
    if(editing && view.canEdit){const list=el("ol","check-plan-choices");for(const task of [...selected.map(id=>context.tasks.find(task=>task.id===id)),...context.tasks.filter(task=>!selected.includes(task.id))].filter(Boolean)){
      const item=el("li"),label=el("label"),input=el("input");input.type="checkbox";input.checked=selected.includes(task.id);input.disabled=Boolean(pendingCheckDecision);input.setAttribute("aria-label",`Include ${task.label}`);input.dataset.artifactFocus=`${key}:include:${task.id}`;input.addEventListener("change",()=>setCheckSuggestionSelection(turn,input.checked?[...selected,task.id]:selected.filter(id=>id!==task.id)));label.append(input,el("span","",task.label));item.append(label);list.append(item);
    }body.append(list);if(selected.length===2){const reverse=artifactButton("Reverse check order",()=>setCheckSuggestionSelection(turn,[...selected].reverse()),`${key}:reverse`);reverse.disabled=Boolean(pendingCheckDecision);body.append(reverse);}}
    const list=el("ol","check-suggestion-steps");list.setAttribute("aria-label","Selected checks");for(const [index,id] of selected.entries()){
      const task=context.tasks.find(task=>task.id===id);if(!task)continue;const item=el("li"),reason=suggestion.checks.find(check=>check.taskId===id)?.reason;item.append(el("strong","",`${index+1}. ${task.label}`),el("p","",reason || "Added by you. No AI rationale was supplied for this check."));list.append(item);
    }if(selected.length)body.append(list);else body.append(el("p","artifact-boundary","No checks selected."));
    if(changed && suggestion.checks.length){const original=el("ol","check-suggestion-steps");for(const check of suggestion.checks){const item=el("li");item.append(el("strong","",context.tasks.find(task=>task.id===check.taskId)?.label || check.taskId),el("p","",check.reason));original.append(item);}body.append(contentDetails("Original AI recommendation",`${key}:original`,[original]));}
    if(suggestion.limitations.length)body.append(structuredList("Limitations",suggestion.limitations,`${key}:limits`));
    body.append(el("p","artifact-boundary",view.accepted?"Saving selected checks did not run them. Open the saved plan to choose the next step.":"Saving creates a check plan. Nothing runs until you choose Run in that plan."));
    const scope=[el("p","artifact-boundary",`Staged group ${context.groupId} · revision ${context.groupRevision}`),el("p","artifact-boundary",`Source snapshot ${context.snapshotRevision}`),el("p","artifact-boundary",`Supported checks · ${context.tasks.map(task=>task.label).join(" · ")}`)];body.append(contentDetails("Check scope",`${key}:scope`,scope));
    const actions=[];
    if(view.accepted){const open=artifactButton("Open check plan",()=>checkSuggestionAction(turn,"open"),`${key}:open-plan`,true);open.disabled=!view.canOpen || Boolean(pendingCheckDecision);actions.push(open);}
    else if(!turn.checkDismissed){const save=artifactButton("Save check plan",()=>checkSuggestionAction(turn,"save"),`${key}:save`,true);save.disabled=!view.canSave || Boolean(pendingCheckDecision);actions.push(save);if(!editing){const edit=artifactButton("Edit checks",()=>openArtifact({kind:"check-suggestion",turnId:turn.id,edit:true}),`${key}:edit`);edit.disabled=!view.canEdit || Boolean(pendingCheckDecision);actions.push(edit);}const dismiss=artifactButton("Dismiss suggestion",()=>checkSuggestionAction(turn,"dismiss"),`${key}:dismiss`);dismiss.disabled=!view.canDismiss || Boolean(pendingCheckDecision);actions.push(dismiss);}
    if(!view.accepted && !turn.checkDismissed && view.basis.sameGroup && !view.basis.ready){const group=state.changeSetSession.current,prepare=artifactButton("Prepare workspace",()=>executionAction(group,"prepare"),`${key}:prepare`);prepare.disabled=!executionView(group).canPrepare;body.append(prepare);}
    return artifactCard({id:key,kind:"Suggested checks",title:suggestion.title,status:view.status,scope:`${selected.length} selected`,provenance:changed?"AI interpretation · Edited by you":"AI interpretation",freshness:view.basis.evidence.status==="current"?"Matches saved basis":artifactFreshnessLabel(view.basis.evidence),body,actions,expanded,warnings:[view.reason,checkSuggestionErrors.get(checkSuggestionKey(turn))],open:()=>openArtifact({kind:"check-suggestion",turnId:turn.id})});
  }
  function requestRevisionView(descriptor=state.requestRevision) {
    return artifacts.requestRevisionState(descriptor,activeConversation(),state.intent,state.context,sourceFiles(),state.dirtyPaths);
  }
  function validateRestoredRequestRevision() {
    if(!state.requestRevision)return;
    const view=requestRevisionView();
    // Invalid identity or saved provenance never revives a binding on restart.
    // Source changes remain visible and block Send until the binding is removed.
    if(!view.valid){state.requestRevision=null;state.requestRevisionNotice="The saved request link could not be restored. Your draft is now a new request.";}
  }
  function requestRevisionBlocker() {return state.requestRevision ? requestRevisionView().reason : "";}
  function revisionPreparationReason(turn) {
    if(!state.trusted || !state.project)return "Trust this workspace before revising a request.";
    if(activeConversation()?.archived)return "Restore this conversation to revise a request.";
    if(state.historyAction || state.conversations?.storage?.status!=="saved")return "Wait for conversation history to be saved.";
    if(pendingRequestRevision)return "Preparing a saved request…";
    if(pendingPlanAction)return "Wait for the current plan action to finish.";
    if(turn.ephemeral || !activeConversation()?.turns.some(item=>item.requestId===turn.requestId))return "Only requests saved in this conversation can be revised.";
    if(turn.investigationContext)return "Continue from the latest investigation checkpoint.";
    if(turn.sourceInvestigation)return "Prepare current relationships to investigate this source again.";
    if(turn.checkContext)return "Prepare Suggest checks from the staged group again.";
    if(turn.groupRevision)return "Use Refine group to revise the current staged version.";
    if(turn.planContext)return "Prepare this Build from its original plan step instead.";
    if(turn.state==="stopping")return "Wait for this response to stop.";
    if(state.running && turn.state!=="running")return "Stop the active response before revising this request.";
    if(!["running","complete","stopped","failed","interrupted"].includes(turn.state))return "This request is not available to revise.";
    return "";
  }
  function prepareRequestRevision(turn) {
    if(revisionPreparationReason(turn))return;
    const identity=assistantIdentity();if(!identity?.conversationId)return;
    pendingPlanPreparation=null;requestRevisionErrors.delete(turn.requestId);
    const prepareId=`revise-request-${crypto.randomUUID()}`;
    pendingRequestRevision={...identity,requestId:turn.requestId,prepareId,generation:assistantDraftGeneration};
    const action=turn.state==="running"?"stopAndPrepare":"prepare";
    if(action==="stopAndPrepare")turn.state="stopping";
    vscode.postMessage({type:"requestRevisionAction",action,...identity,requestId:turn.requestId,prepareId});
    renderAssistant();
  }
  function requestRevisionControl(turn,label) {
    const reason=revisionPreparationReason(turn),control=artifactButton(label || (turn.state==="running"?"Stop and revise":"Revise request"),()=>prepareRequestRevision(turn),`request/${turn.requestId}:${label?"retry":"revise"}`);
    control.disabled=Boolean(reason);if(reason)control.title=reason;
    return control;
  }
  function requestRevisionCard() {
    if(!state.requestRevision)return null;
    const view=requestRevisionView(),card=el("section","prepared-plan-context request-revision-context");card.setAttribute("aria-label","Revising a saved request");
    card.append(el("strong","","Revising a saved request"),el("p","request-revision-question",view.parent?.question || "Original request unavailable"),el("p","artifact-boundary","New request. Previous output is not included. Choose task and runtime context again."));
    if(view.reason)card.append(el("p","request-revision-warning",view.reason));
    const actions=el("div","plan-form-actions"),remove=artifactButton("Remove request revision",()=>{detachRequestRevision();markAssistantDraftEdited();saveView();renderAssistant();},"request-revision/remove");remove.disabled=state.running;actions.append(remove);card.append(actions);return card;
  }
  function savedRequestRevision(turn) {
    const descriptor=validateRequestRevision(turn.requestRevision);if(!descriptor)return null;
    const row=el("div","request-revision-lineage");row.append(el("p","","Revised from a saved request · previous output not included"));
    const parent=descriptor.conversationId===state.conversations?.activeId && state.turns.find(item=>item.requestId===descriptor.requestId);
    const view=artifactButton("View original request",()=>{
      if(!parent)return;const target=root.querySelector(`[data-turn-id="${CSS.escape(parent.requestId)}"]`);
      target?.scrollIntoView({block:"nearest"});target?.focus({preventScroll:true});
    },`request/${turn.requestId}:original`);view.disabled=!parent;if(!parent)view.title="The original request is unavailable in this conversation.";row.append(view);return row;
  }

  function responseArtifact(turn, expanded = false) {
    const id = `request/${turn.requestId}/response`;
    const evidence = artifacts.freshness(turn.context, sourceFiles(), state.dirtyPaths);
    const partial = ["stopped", "failed", "interrupted"].includes(turn.state);
    const status = turn.state === "running" ? (turn.started ? "Responding" : "Preparing request") : turn.state === "stopping" ? "Stopping…" : turn.state === "stopped" ? "Cancelled · partial preserved" : turn.state === "failed" ? "Failed · partial preserved" : turn.state === "interrupted" ? "Interrupted · partial preserved" : turn.completedWhileStopping ? "Finished during stop · partial retained" : "Complete";
    const body = el("div");
    body.append(turn.answer && normalizeIntent(turn.intent) !== "build" ? answerText(turn) : el("p", "thinking", normalizeIntent(turn.intent) === "build" ? partial ? "No applicable proposal was completed." : "Preparing scoped source changes…" : partial ? "No answer text was returned." : "Reading the selected source…"));
    if (turn.error) body.append(note(turn.error, "error"));
    if (turn.ephemeral) body.append(el("p", "artifact-boundary", "This failed request could not be saved to history. It remains available in this window."));
    if (turn.completedWhileStopping) body.append(el("p", "artifact-boundary", "The request finished while Stop was being processed. The displayed text may be partial."));
    if (turn.state === "stopped") body.append(el("p", "artifact-boundary", "Foundation stopped receiving this request. The provider may already have processed some input."));
    if (turn.state === "interrupted") body.append(el("p", "artifact-boundary", "Interrupted before completion. Saved text is preserved; this request will not resume automatically."));
    const usage = el("div", "answer-meta");
    if (turn.model) usage.append(el("span", "", turn.model));
    usage.append(el("span", "", turn.usage?.total_tokens !== undefined ? `${turn.usage.total_tokens.toLocaleString()} tokens` : "Usage not reported"));
    const receipt = el("p", "", turn.started ? "Request dispatch confirmed." : "Request dispatch was not confirmed.");
    body.append(contentDetails("Request details", `${id}:request`, [usage, receipt]));if(!turn.groupRevision && !turn.checkContext)body.append(sourceSnapshots(turn.context, `${id}:sources`));
    const taskContext=savedTaskContext(turn);if(taskContext)body.append(taskContext);
    const runtimeEvidence=runtimeEvidenceHistory(turn);if(runtimeEvidence)body.append(runtimeEvidence);
    const actions = [];
    if (turn.state === "running") actions.push(artifactButton("Stop response", stop, `${id}:stop`, false, "stop"));
    else if (turn.state === "stopping") { const control = artifactButton("Stopping…", () => {}, `${id}:stop`); control.setAttribute("aria-disabled", "true"); actions.push(control); }
    else if (partial && !activeConversation()?.archived) actions.push(requestRevisionControl(turn,"Prepare another request"));
    if(turn.sourceInvestigation || turn.investigationContext)appendContinuationActions(turn,actions,id);
    if(continuationErrors.has(turn.requestId))body.append(note(continuationErrors.get(turn.requestId),"warning"));
    const warnings = [evidence.status === "stale" ? "Saved source changed. This response describes its original snapshots; citations open current source." : evidence.status === "unknown" ? "Some source is unavailable. Its freshness is unknown until refreshed." : "", evidence.drafts.length ? "Editor drafts are not included in these saved snapshots." : ""];
    return artifactCard({id, kind:normalizeIntent(turn.intent) === "build" ? "Task" : "Explanation", title:normalizeIntent(turn.intent) === "build" ? "Prepare a source change" : turn.checkContext?"Check suggestion":normalizeIntent(turn.intent)==="plan" ? "Plan response" : normalizeIntent(turn.intent)==="review"?"Review response":"Answer", status, scope:"", provenance:"AI interpretation", freshness:turn.sourceInvestigation || turn.investigationContext ? "Historical investigation" : evidence.status === "current" ? "Matches saved source" : evidence.status === "stale" ? "Stale" : "Freshness unknown", body, actions, warnings, expanded, open:() => openArtifact({kind:"response", turnId:turn.id})});
  }
  function closeArtifact() {
    if (!artifactDialog?.open) return;
    const restore = document.hasFocus();
    expandedArtifact = null;
    artifactDialog.close();
    // Restore synchronously. The native close event is queued and must not
    // override a later user focus choice or a background host refresh.
    if (restore) root.querySelector(`[data-artifact-focus="${CSS.escape(artifactReturnFocus || "")}"]`)?.focus({preventScroll:true});
  }
  function openArtifact(reference) {
    expandedArtifact = reference;
    artifactReturnFocus = document.activeElement?.dataset.artifactFocus;
    if (!artifactDialog) {
      artifactDialog = el("dialog", "native-artifact-dialog");
      artifactDialog.setAttribute("aria-label", "Artifact details");
      document.body.append(artifactDialog);
      artifactDialog.addEventListener("cancel", event => { event.preventDefault(); closeArtifact(); });
      artifactDialog.addEventListener("close", () => { if (!artifactDialog.open) expandedArtifact = null; });
    }
    updateArtifactDialog();
    if (!artifactDialog.open) artifactDialog.showModal();
    artifactDialog.querySelector(".artifact-close")?.focus();
  }
  function updateArtifactDialog() {
    if (!artifactDialog || !expandedArtifact) return;
    const focus = document.hasFocus() ? document.activeElement?.dataset.artifactFocus : null;
    const top = artifactDialog.scrollTop;
    let card;
    if(expandedArtifact.kind==="change-set") {
      const group=currentChangeSet(expandedArtifact.changeSetId);if(group)card=changeSetArtifact(group,true);
    } else if (["plan","source-review"].includes(expandedArtifact.kind)) {
      const turn=state.turns.find(turn=>turn.id===expandedArtifact.turnId);
      if(turn)card=expandedArtifact.kind==="plan" && turn.plan?planArtifact(turn,true,expandedArtifact.edit===true):turn.review?reviewArtifact(turn,true):null;
    } else if(expandedArtifact.kind==="check-suggestion") {
      const turn=state.turns.find(item=>item.id===expandedArtifact.turnId);if(turn?.checkSuggestion)card=checkSuggestionArtifact(turn,true,expandedArtifact.edit===true);
    } else if (expandedArtifact.kind === "response") {
      const turn = state.turns.find(item => item.id === expandedArtifact.turnId);
      if(turn?.checkSuggestion){expandedArtifact={kind:"check-suggestion",turnId:turn.id};card=checkSuggestionArtifact(turn,true);}
      else if(turn?.changeSet) {
        expandedArtifact={kind:"change-set",changeSetId:turn.changeSet.id};artifactReturnFocus=`change-set/${turn.changeSet.id}:review`;card=changeSetArtifact(currentChangeSet(turn.changeSet.id) || turn.changeSet,true);
      } else if (turn?.proposal) {
        expandedArtifact = {kind:"changes", proposalId:turn.proposal.id};
        artifactReturnFocus = `proposal/${turn.proposal.id}:review`;
        card = changeArtifact(currentProposal(turn.proposal.id) || turn.proposal, true);
      } else if (turn) card = responseArtifact(turn, true);
    } else {
      const proposal = currentProposal(expandedArtifact.proposalId);
      if (proposal) card = expandedArtifact.kind === "verification" ? verificationArtifact(proposal, true) : changeArtifact(proposal, true);
    }
    if (!card) { closeArtifact(); return; }
    const toolbar = el("div", "artifact-dialog-toolbar");
    const close = artifactButton("Close", closeArtifact, "artifact-close", false, "close"); close.classList.add("artifact-close");
    toolbar.append(close); artifactDialog.replaceChildren(toolbar, card); artifactDialog.scrollTop = top;refreshPlanControls();
    if (focus) {
      const candidate = artifactDialog.querySelector(`[data-artifact-focus="${CSS.escape(focus)}"]`);
      (candidate && !candidate.disabled ? candidate : artifactDialog.querySelector(".artifact-close"))?.focus({preventScroll:true});
    }
  }

  function turnView(turn) {
    const section = el("article", "assistant-turn");
    section.dataset.turnId = turn.requestId;section.tabIndex=-1;
    const header=el("div","question-header");header.append(el("span","question-author","You"));
    if(!turn.ephemeral && !turn.alternativeGeneration && turn.state!=="stopping")header.append(requestRevisionControl(turn));
    section.append(header,el("p","question-text",turn.question));
    const continuation=savedContinuationContext(turn);if(continuation)section.append(continuation);
    const investigation=savedSourceInvestigation(turn);if(investigation)section.append(investigation);
    const revision=savedRequestRevision(turn);if(revision)section.append(revision);
    const groupContext=savedGroupRevision(turn);if(groupContext)section.append(groupContext);
    const revisionError=requestRevisionErrors.get(turn.requestId);if(revisionError)section.append(note(revisionError,"error"));
    if(turn.checkContext){const shared=savedCheckContext(turn);if(shared)section.append(shared);}
    if(turn.planContext)section.append(el("p","artifact-boundary","Prepare this Build from its original plan step instead."));
    if(turn.alternatives && turn.alternativeGeneration)section.append(aiAlternativesArtifact(turn));
    else if(turn.investigationDecision)section.append(investigationDecisionArtifact(turn));
    else if(turn.checkSuggestion)section.append(checkSuggestionArtifact(turn));
    else if(turn.plan)section.append(planArtifact(turn));
    else if(turn.review)section.append(reviewArtifact(turn));
    else if(turn.changeSet)section.append(changeSetArtifact(currentChangeSet(turn.changeSet.id) || turn.changeSet));
    else if (turn.proposal) {
      const proposal = currentProposal(turn.proposal.id) || turn.proposal;
      section.append(changeArtifact(proposal), verificationArtifact(proposal));
    } else { section.append(responseArtifact(turn)); if (turn.answer && normalizeIntent(turn.intent) !== "build") section.dataset.plainResponse = "true"; }
    if(turn.proposal || turn.changeSet){const taskContext=savedTaskContext(turn);if(taskContext)section.append(taskContext);const runtimeEvidence=runtimeEvidenceHistory(turn);if(runtimeEvidence)section.append(runtimeEvidence);}
    const decisions=savedDecisionContext(turn);if(decisions)section.append(decisions);
    const issues=savedIssueContext(turn);if(issues)section.append(issues);
    const planContext=savedPlanContext(turn);if(planContext)section.append(planContext);
    return section;
  }
  function requestBlocker() {
    if(aiAlternativeBlocker())return aiAlternativeBlocker();
    if(continuationBlocker())return continuationBlocker();
    if(pendingContinuationAction || state.investigationContinuation?.busy)return "Finish or stop the local investigation first.";
    if(investigationBlocker())return investigationBlocker();
    if(pendingCheckSuggestion)return "Preparing supported checks…";
    if(pendingCheckDecision)return "Saving the check decision…";
    if(pendingGroupRevision)return "Preparing the staged group…";
    if(pendingRequestRevision)return "Preparing a saved request…";
    if (state.running) return "You can stop at any time.";
    if(pendingPlanAction)return pendingPlanAction.action==="revise"?"Saving plan…":pendingPlanAction.action==="prepareBuild"?"Preparing selected step…":"Checking artifact source…";
    if (activeConversation()?.archived) return "Restore this conversation to continue.";
    if (state.historyAction) return "Updating conversation…";
    if (["error", "unavailable"].includes(state.conversations?.storage?.status)) return "Resolve the history storage issue before sending.";
    if (!state.provider?.configured) return "Choose a provider and model.";
    if (featureTaskBlocker()) return featureTaskBlocker();
    if (planContextBlocker()) return planContextBlocker();
    if (requestRevisionBlocker()) return requestRevisionBlocker();
    if (groupRevisionBlocker()) return groupRevisionBlocker();
    if (checkContextBlocker()) return checkContextBlocker();
    if (changeSetBuildBlocker()) return changeSetBuildBlocker();
    if (contextRestoreBlocker()) return contextRestoreBlocker();
    if (decisionContextBlocker()) return decisionContextBlocker();
    if (issueContextBlocker()) return issueContextBlocker();
    const files = selectedFiles();
    if (files.some(file => state.dirtyPaths.includes(file.path))) return "Save the selected files before sending.";
    if (!files.length) return "Select a saved source file in Context.";
    if (state.runtimeObservationIds.length > 12) return "Select no more than twelve runtime observations.";
    if (state.runtimeObservationIds.length && (state.runtime?.status !== "connected" || selectedRuntimeEvidence().length !== state.runtimeObservationIds.length)) return "Runtime evidence is unavailable. Reconnect or remove it from Context.";
    if (files.length > 8) return "Select no more than eight files.";
    if (files.reduce((total,file) => total + byteLength(file.source),0) > 65536) return "Selected source exceeds 64 KiB. Remove a file.";
    if(state.continuationContext)return "Saved source · Plan";
    if(state.investigationContext)return "Selected source and relationship evidence";
    if(state.checkContext)return "Suggested checks · Save and Run stay separate";
    if(state.groupRevision)return "New proposal · current group stays staged until ready";
    if(state.alternativeGenerationDraft)return "Two options · source unchanged";
    return state.intent === "plan" ? "Editable plan · no execution" : state.intent === "review" ? "Saved-source review · checks not run" : state.intent === "build" ? state.planContext?"Review before applying · 1 file":"Review before applying · up to 8 files" : selectedRuntimeEvidence().length ? "Selected source and observations" : "Selected source only";
  }
  function canAsk() {
    const files = selectedFiles();
    return (
      !externalAssistant &&
      state.trusted &&
      state.provider?.configured &&
      !state.running &&
      !state.historyAction &&
      !aiAlternativeBlocker() &&
      !continuationBlocker() &&
      !pendingContinuationAction &&
      !state.investigationContinuation?.busy &&
      !investigationBlocker() &&
      !featureTaskBlocker() &&
      !planContextBlocker() &&
      !requestRevisionBlocker() &&
      !groupRevisionBlocker() &&
      !checkContextBlocker() &&
      !pendingCheckSuggestion &&
      !pendingCheckDecision &&
      !pendingGroupRevision &&
      !pendingRequestRevision &&
      !changeSetBuildBlocker() &&
      !pendingPlanAction &&
      !contextRestoreBlocker() &&
      !decisionContextBlocker() &&
      !issueContextBlocker() &&
      !activeConversation()?.archived &&
      (!state.conversations || !["error", "unavailable"].includes(state.conversations.storage?.status)) &&
      state.question.trim().length > 0 &&
      state.question.length <= 6000 &&
      files.length > 0 &&
      files.length <= 8 &&
      state.runtimeObservationIds.length <= 12 &&
      (!state.runtimeObservationIds.length || (state.runtime?.status === "connected" && selectedRuntimeEvidence().length === state.runtimeObservationIds.length)) &&
      files.reduce((n, file) => n + byteLength(file.source), 0) <= 65536 &&
      !files.some((file) => state.dirtyPaths.includes(file.path))
    );
  }
  function ask() {
    if (!canAsk()) return;
    const files = selectedFiles();
    const context = files.map((file, index) => ({
      id: `S${index + 1}`,
      path: file.path,
      revision: file.revision,
      source: file.source,
      lines: file.source.split("\n").length,
    }));
    const alternativeGeneration=selectedAlternativeGeneration();
    const question = state.question.trim(),requestRevision=state.requestRevision,groupRevision=state.groupRevision,checkContext=state.checkContext,sourceInvestigation=state.investigationContext,investigationContext=state.continuationContext;
    state.turns.push({
      id: ++turnCounter,
      requestId: `request-${crypto.randomUUID()}`,
      started: false,
      question,
      intent: state.intent,
      ...(alternativeGeneration?{alternativeGeneration}:{}),
      answer: "",
      state: "running",
      context,
      model: state.provider.model,
      runtimeEvidence: checkContext || sourceInvestigation || investigationContext?[]:selectedRuntimeEvidence().map(item => ({...item})),
      ...(selectedDecisionSnapshot()?{decisionContext:structuredClone(selectedDecisionSnapshot())}:{}),
      ...(selectedIssueSnapshot()?{issueContext:structuredClone(selectedIssueSnapshot())}:{}),
      ...(requestRevision?{requestRevision}:{}),
      ...(groupRevision?{groupRevision}:{}),
      ...(checkContext?{checkContext}:{}),
      ...(sourceInvestigation?{sourceInvestigation}:{}),
      ...(investigationContext?{investigationContext}:{}),
      ...(state.intent==="build" && selectedPlanSnapshot()?{planContext:selectedPlanSnapshot()}:{}),
      ...(!checkContext && !sourceInvestigation && !investigationContext && state.featureTaskIncluded && activeFeature() ? {taskContext:{version:1,featureId:activeFeature().id,title:activeFeature().title,brief:activeFeature().brief,revision:state.features.revision}} : {}),
    });
    state.running = true;
    state.pendingRequestId = state.turns.at(-1).requestId;
    state.question = "";state.alternativeGenerationDraft=null;state.continuationContext=null;state.continuationRefreshed=false;state.continuationNotice="";state.investigationContext=null;state.investigationRefreshed=false;state.investigationNotice="";state.checkContext=null;state.checkContextNotice="";state.requestRevision=null;state.requestRevisionNotice="";state.groupRevision=null;state.groupRevisionNotice="";
    saveView();
    renderAssistant();
    vscode.postMessage({
      type: "ask",
      requestId: state.turns.at(-1).requestId,
      ...(state.conversations ? { conversationId: state.conversations.activeId, projectId: state.project?.id } : {}),
      prompt: question,
      ...(alternativeGeneration?{alternativeGeneration}:{}),
      ...(state.decisionContext.length?{decisionContext:state.decisionContext.map(item=>({...item}))}:{}),
      ...(selectedIssueSnapshot()?{issueContext:selectedIssueSnapshot().issues.map(item=>({id:item.issue.id,digest:item.digest,assessment:structuredClone(item.assessment)}))}:{}),
      ...(requestRevision?{requestRevision}:{}),
      ...(groupRevision?{groupRevision}:{}),
      ...(checkContext?{checkContext}:{}),
      ...(sourceInvestigation?{sourceInvestigation:investigationDescriptor(sourceInvestigation)}:{}),
      ...(investigationContext?{investigationContinuation:continuationDescriptor(investigationContext)}:{}),
      intent: state.intent,
      context: context.map(({ path, revision }) => ({ path, revision })),
      ...(!checkContext && !sourceInvestigation && !investigationContext && state.featureTaskIncluded && activeFeature() ? {taskContext:{featureId:activeFeature().id,revision:state.features.revision}} : {}),
      ...(!checkContext && !sourceInvestigation && !investigationContext && state.intent==="build" && state.planContext?{planContext:state.planContext}:{}),
      ...(!checkContext && !sourceInvestigation && !investigationContext && state.runtimeObservationIds.length ? {runtimeContext:{session:state.runtime.session,observationIds:[...state.runtimeObservationIds]}} : {}),
    });
  }
  function stop() {
    const turn = state.turns.at(-1);
    if (turn?.state !== "running") return;
    turn.state = "stopping";
    vscode.postMessage({ type: "cancel", requestId: turn.requestId });
    renderAssistant();
  }
  function formatHistoryTime(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" }) : "Date unavailable";
  }
  function rememberEphemeral(turn) {
    const key = state.conversations?.activeId || "new";
    const turns = ephemeralTurns.get(key) || [];
    if (!turns.some(item => item.requestId === turn.requestId)) turns.push({...turn, ephemeral:true});
    ephemeralTurns.set(key, turns);
  }
  function applyConversations(snapshot, terminalRequestId) {
    if (!artifacts.acceptsConversationSnapshot(snapshot, state.conversations, state.project?.id)) return false;
    const previousId = state.conversations?.activeId || null;
    const previous = state.conversations;
    const pending = state.pendingRequestId && state.turns.find(turn => turn.requestId === state.pendingRequestId);
    const stopping = state.turns.find(turn => turn.state === "stopping");
    state.conversations = snapshot;
    const active = activeConversation();
    const changed = previousId !== snapshot.activeId;
    const createdFromPending=Boolean(changed && previous && previousId===null && pending && !state.historyAction);
    if (changed) {
      const previousContext=previous ? validateAssistantContext({version:1,projectId:state.project.id,featureId:state.features?.activeId || null,conversationId:previousId,initialized:state.contextInitialized,paths:state.context,includeTaskBrief:state.featureTaskIncluded,...(state.decisionContext.length?{decisionContext:state.decisionContext}:{}),...(state.issueContext.length?{issueContext:state.issueContext}:{}),...(state.planContext?{planContext:state.planContext}:{}),...(state.requestRevision?{requestRevision:state.requestRevision}:{}),...(state.groupRevision?{groupRevision:state.groupRevision}:{}),...(state.checkContext?{checkContext:state.checkContext}:{}),...(state.investigationContext?{sourceInvestigation:state.investigationContext}:{}),...(state.continuationContext?{investigationContext:state.continuationContext}:{})}) : null;
      conversationDrafts.set(previousId || "new",{question:state.question,intent:state.intent,context:previousContext});
      state.question = !previous && assistantDraftEdited ? state.question : conversationDrafts.get(snapshot.activeId || "new")?.question ??
        (!hasPersistedAssistantContext && !previous && persisted.questionProjectId === state.project?.id && persisted.questionConversationId === snapshot.activeId ? persistedQuestion : "");
      if(previous && !createdFromPending){state.context=[];state.contextInitialized=Boolean(activeFeature());state.featureTaskIncluded=false;clearAssistantSourceRestore();pendingAssistantRestore=null;coldAssistantContextResolved=true;}
      const restoredDraft=conversationDrafts.get(snapshot.activeId || "new");
      if(previous && !createdFromPending && (restoredDraft?.context?.requestRevision || restoredDraft?.context?.groupRevision || restoredDraft?.context?.checkContext || restoredDraft?.context?.sourceInvestigation || restoredDraft?.context?.investigationContext) && matchingAssistantIdentity(restoredDraft.context,assistantIdentity())) {
        state.context=[...restoredDraft.context.paths];state.contextInitialized=restoredDraft.context.initialized;state.decisionContext=restoredDraft.context.decisionContext || [];state.issueContext=restoredDraft.context.issueContext || [];state.featureTaskIncluded=restoredDraft.context.includeTaskBrief;state.intent=restoredDraft.intent;state.planContext=restoredDraft.context.planContext || null;state.requestRevision=restoredDraft.context.requestRevision || null;state.groupRevision=restoredDraft.context.groupRevision || null;state.checkContext=restoredDraft.context.checkContext || null;state.investigationContext=restoredDraft.context.sourceInvestigation || null;state.investigationRefreshed=false;state.continuationContext=restoredDraft.context.investigationContext || null;state.continuationRefreshed=false;requestAssistantSources();
      }
      if(createdFromPending && assistantRestoreRequest)requestAssistantSources();
      closeArtifact(); artifactCollapsed.clear(); disclosureState.clear(); state.runtimeObservationIds=[];
      if (state.historyAction) state.historyFocus = true;
      state.historyOpen = false;
    }
    state.turns = Array.isArray(active?.turns) ? active.turns.map(turn => ({...turn, context: turn.context || []})) : [];
    // A disk write can publish its saving status before the host accepts the
    // request. Keep only that local optimistic turn until it is acknowledged.
    if (pending && !state.turns.some(turn => turn.requestId === pending.requestId) &&
      terminalRequestId !== pending.requestId && (!changed || previousId === null) && !active?.archived) state.turns.push(pending);
    else if (state.turns.some(turn => turn.requestId === state.pendingRequestId) || terminalRequestId === state.pendingRequestId || changed) state.pendingRequestId = null;
    for (const local of ephemeralTurns.get(snapshot.activeId || "new") || []) {
      if (!state.turns.some(turn => turn.requestId === local.requestId)) state.turns.push(local);
    }
    if (stopping) {
      const restored = state.turns.find(turn => turn.requestId === stopping.requestId);
      if (restored?.state === "running") Object.assign(restored, {state:"stopping", answer:stopping.answer});
      else if (restored?.state === "complete") restored.completedWhileStopping = true;
    }
    state.running = state.turns.some(turn => ["running", "stopping"].includes(turn.state));
    if (state.historyAction && (snapshot.revision > state.historyAction.revision || ["saved", "error", "unavailable"].includes(snapshot.storage?.status))) {
      state.historyAction = null; state.historyFocus = true;
    }
    validateRestoredRequestRevision();validateRestoredGroupRevision();validateRestoredCheckContext();syncPlanDrafts();saveView();
    return true;
  }
  function conversationAction(action, id) {
    if (!state.project || !state.trusted || state.running || state.historyAction) return;
    if(pendingContinuation)clearContinuation();pendingContinuationAction=null;
    pendingRequestRevision=null;pendingGroupRevision=null;pendingCheckSuggestion=null;pendingCheckDecision=null;assistantDraftGeneration++;
    state.historyAction = { action, revision:state.conversations?.revision ?? -1 };
    state.historyOpen = false;
    vscode.postMessage({type:"conversation", action, projectId:state.project.id, ...(id ? {id} : {})});
    renderAssistant();
  }
  function conversationHeader() {
    const history = state.conversations;
    if (!history && !assistantSurface) return null;
    const active = activeConversation();
    const disabled = state.running || Boolean(state.historyAction) || !state.trusted || history?.storage?.status === "unavailable";
    const header = el("section", "conversation-header");
    header.setAttribute("aria-label", "Conversation history");
    const row = el("div", "conversation-toolbar");
    const title = el("div", "conversation-title");
    title.append(el("h2", "", active?.title || "New conversation"), el("span", "", active?.archived ? "Archived · read-only" : active && history?.storage?.status === "saved" ? "Saved on this device" : "Local project history"));
    row.append(title);
    const controls = el("div", "conversation-controls");
    const historyButton = button("History", () => { state.historyOpen = !state.historyOpen; renderAssistant(); }, "button small", "history");
    historyButton.setAttribute("aria-expanded", String(state.historyOpen));
    historyButton.setAttribute("aria-controls", "conversation-history-list");
    historyButton.dataset.artifactFocus = "conversation-history";
    historyButton.addEventListener("keydown", event => {
      if (event.key === "Escape" && state.historyOpen) { event.preventDefault(); state.historyOpen=false; state.historyFocus=true; renderAssistant(); }
    });
    historyButton.disabled = state.running || Boolean(state.historyAction) || !state.trusted;
    controls.append(historyButton);
    const create = button("New", () => conversationAction("new"), "button small", "plus");
    create.setAttribute("aria-label", "New conversation"); create.dataset.artifactFocus = "conversation-new"; create.disabled = disabled;
    controls.append(create);
    if (assistantSurface) {
      historyButton.setAttribute("aria-label", "History"); historyButton.title = "Conversation history";
      create.title = "New conversation";
      historyButton.disabled ||= !history; create.disabled ||= !history;
    }
    row.append(controls); header.append(row);
    if (state.historyOpen && history) {
      const list = el("div", "conversation-history-list"); list.id = "conversation-history-list";
      list.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); state.historyOpen=false; state.historyFocus=true; renderAssistant(); } });
      const items = [...history.conversations].sort((a,b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      for (const archived of [false, true]) {
        const group = items.filter(item => Boolean(item.archived) === archived);
        if (!group.length) continue;
        const section = el("section", "history-group");
        section.append(el("h3", "", archived ? "Archived" : "Recent"));
        for (const item of group) {
          const choose = button("", () => conversationAction("select", item.id), "history-choice");
          choose.setAttribute("aria-label", `${item.title} · ${item.turns.length} ${item.turns.length === 1 ? "request" : "requests"}${archived ? " · Archived" : ""}`);
          choose.dataset.artifactFocus = `conversation/${item.id}`;
          if (item.id === history.activeId) choose.setAttribute("aria-current", "true");
          choose.disabled = disabled;
          const label = el("div", "history-choice-copy");
          label.append(el("strong", "", item.title), el("span", "", `${item.turns.length} ${item.turns.length === 1 ? "request" : "requests"} · ${formatHistoryTime(item.updatedAt)}`));
          choose.append(label, icon(item.id === history.activeId ? "check" : "arrow", 16)); section.append(choose);
        }
        list.append(section);
      }
      if (!items.length) list.append(el("p", "quiet", "Your conversations will appear here."));
      if (active) {
        const archive = button(active.archived ? "Restore conversation" : "Archive conversation", () => conversationAction(active.archived ? "restore" : "archive", active.id), "button small", "archive");
        archive.dataset.artifactFocus = "conversation-archive"; archive.disabled=disabled; list.append(archive);
      }
      header.append(list);
    }
    const status = history?.storage?.status;
    const statusLine = el("div", `conversation-storage ${status || ""}`); statusLine.setAttribute("role", "status");
    statusLine.append(el("span", "", status === "saving" ? "Saving locally…" : status === "error" ? history.storage.message || "History has not been saved. Your current response remains in this window." : status === "unavailable" ? history.storage.message || "Saved history could not be opened. Its contents have been preserved." : "Prompts, responses and source snapshots stay in this project’s local history."));
    if (status === "error" || status === "unavailable") {
      const retry = button(status === "unavailable" ? "Retry loading" : "Retry saving", () => conversationAction("retry"), "button small");
      retry.dataset.artifactFocus = "conversation-retry"; retry.disabled = state.running || Boolean(state.historyAction); statusLine.append(retry);
    }
    if (status && status !== "saved") header.append(statusLine);
    return header;
  }
  function assistant() {
    const wrap = el("div", "assistant-page");
    const heading = el("div", "page-heading");
    if (state.conversations) {
      heading.classList.add("assistant-durable-heading");
      heading.append(el("h1", "", "Assistant"));
    } else heading.append(el("h1", "", "Assistant"));
    if (!assistantSurface) wrap.append(heading);
    const provider = el(
      "section",
      state.provider?.configured ? "provider connected" : "provider",
    );
    const copy = el("div");
    copy.append(
      el(
        "strong",
        "",
        state.provider?.configured
          ? state.provider.model
          : "Set up AI",
      ),
      el(
        "p",
        "",
        state.provider?.configured
          ? `${state.provider.provider} · ${state.provider.transport === "local" ? "Local provider" : "Remote provider"} · connection checked when you ask`
          : state.provider?.reason ||
              "Choose a provider and model to start asking questions.",
      ),
    );
    provider.append(icon("spark", 20), copy);
    if (state.provider?.configured) provider.append(button("AI settings", () => action("foundation.configureAI"), "button small"));
    const side = el("aside", "assistant-context-rail");
    side.setAttribute("aria-label", "Request context and provider");
    side.append(provider);
    const intentions = el("div", "assistant-intents"); intentions.setAttribute("aria-label", "Assistant task");
    for (const [intent, label, detail] of [["ask","Ask","Explain selected source"],["plan","Plan","Create an editable source-grounded plan"],["build","Build","Propose changes to up to 8 selected files"],["review","Review","Review selected saved source"]]) {
      const choice = button("", () => { if(state.intent!==intent)detachRequestRevision();state.intent = intent; markAssistantDraftEdited();saveView(); renderAssistant(); }, state.intent === intent ? "intent-choice selected" : "intent-choice");
      choice.setAttribute("aria-pressed", String(state.intent === intent)); choice.setAttribute("aria-label", `${label} mode`); choice.dataset.designFocus = `intent-${intent}`; choice.disabled = state.running;
      choice.append(icon(({ask:"source",plan:"graph",build:"code",review:"review"})[intent], 18), el("strong", "", label), el("span", "", detail)); intentions.append(choice);
    }
    const layout = el("div", "assistant-layout");
    const conversation = el("section", "assistant-conversation");
    conversation.setAttribute("aria-label", "Conversation");
    const historyHeader = conversationHeader();
    if (historyHeader) (assistantSurface ? wrap : conversation).append(historyHeader);
    if (!assistantSurface) conversation.append(intentions);
    if (!state.conversations && state.proposal && state.proposal.origin === "ai" && !state.turns.some(turn => turn.proposal?.id === state.proposal.id)) {
      conversation.append(el("p", "restored-checkpoint", "Saved proposal checkpoint"), changeArtifact(state.proposal));
    }
    const groupStorage=changeSetStorageNotice();if(groupStorage)conversation.append(groupStorage);const unfinishedPlan=orphanCheckPlanNotice();if(unfinishedPlan)conversation.append(unfinishedPlan);
    const detachedGroup=state.changeSetSession?.current;
    if(detachedGroup && !state.turns.some(turn=>turn.changeSet?.id===detachedGroup.id || turn.alternatives?.candidates?.some(candidate=>candidate.changeSet?.id===detachedGroup.id))){
      conversation.append(el("p","restored-checkpoint","Saved change group checkpoint"),el("p","artifact-boundary","This checkpoint is separate from the requests shown here. Review its saved files before choosing an available checkpoint action."),changeSetArtifact(detachedGroup));
    }
    side.append(assistantSurface ? contextPicker() : artifactCard({id:"context/next-request", kind:"Context", title:"Next request", status:"Not sent", scope:`${state.context.length} selected / ${sourceFiles().length} available`, provenance:"From saved source", body:contextPicker()}));
    if (assistantSurface) {
      const setup = el("details", "assistant-setup");
      setup.open = state.sidebarContextOpen;
      setup.addEventListener("toggle", () => { state.sidebarContextOpen = setup.open; saveView(); });
      const summary = el("summary", "assistant-setup-summary");
      summary.dataset.artifactFocus = "assistant-context";
      summary.setAttribute("aria-label", "Request context and model");
      const copy = el("span", "assistant-setup-copy");
      copy.append(el("strong", "", `${state.context.length} ${state.context.length === 1 ? "file" : "files"} selected${state.decisionContext.length?` · ${state.decisionContext.length} ${state.decisionContext.length===1?"decision":"decisions"}`:""}${state.issueContext.length?" · 1 issue":""}${state.runtimeObservationIds.length ? ` · ${state.runtimeObservationIds.length} ${state.runtimeObservationIds.length === 1 ? "observation" : "observations"}` : ""}`), el("span", "", state.provider?.configured ? state.provider.model : "AI not configured"));
      summary.append(icon("source"), copy, icon("chevron", 12)); setup.append(summary, side);
      wrap.append(setup);
    }
    responseRegion = el("div", "assistant-responses");
    responseRegion.setAttribute("aria-label", "Assistant conversation");
    responseRegion.setAttribute("role", "log");
    responseRegion.setAttribute("aria-live", "off");
    if (state.turns.length)
      for (const turn of state.turns) responseRegion.append(turnView(turn));
    else if (!state.provider?.configured) {
      const empty = el("div", "assistant-empty");
      empty.append(icon("spark", 20), el("h2", "", "Ask about your source"), el("p", "", "Set up AI to ask questions and propose changes."));
      responseRegion.append(empty);
    } else {
      const prompts = el("div", "suggested-questions");
      prompts.append(el("p", "quiet", "Try asking"));
      for (const question of (state.intent === "build" ? [
        "Improve the loading and error states without changing the happy path.",
        "Refine the spacing and hierarchy while preserving the design tokens.",
        "Improve keyboard focus and reduced-motion behavior.",
      ] : state.intent==="plan" ? ["Plan clearer loading and error states for this feature.","Plan the smallest safe change and the checks it needs."] : state.intent==="review" ? ["Review this source for correctness and missed error states.","Review accessibility and keyboard behavior in this source."] : ["What does this component do?", "Where does this interaction lead?", "What could fail, and how would we verify it?"]))
        prompts.append(
          button(
            question,
            () => {
              state.question = question;
              markAssistantDraftEdited();saveView();
              if (composer) {
                composer.value = question;
                composer.focus();
              }
              updateAskButton();
            },
            "suggestion",
            "arrow",
          ),
        );
      responseRegion.append(prompts);
    }
    conversation.append(responseRegion);
    const form = el("form", "composer");
    if (assistantSurface) form.append(intentions);
    const alternativesCard=alternativeGenerationCard();if(alternativesCard)form.append(alternativesCard);
    const planCard=planContextCard();if(planCard)form.append(planCard);
    const revisionCard=requestRevisionCard();if(revisionCard)form.append(revisionCard);
    const groupCard=groupRevisionCard();if(groupCard)form.append(groupCard);
    const continuationCard=continuationContextCard();if(continuationCard)form.append(continuationCard);
    const investigationCard=sourceInvestigationCard();if(investigationCard)form.append(investigationCard);
    const checksCard=checkContextCard();if(checksCard)form.append(checksCard);
    if(state.checkContextNotice){const notice=el("p","request-revision-notice",state.checkContextNotice);notice.setAttribute("role","status");form.append(notice);}
    if(state.groupRevisionNotice){const notice=el("p","request-revision-notice",state.groupRevisionNotice);notice.setAttribute("role","status");form.append(notice);}
    if(state.requestRevisionNotice){const notice=el("p","request-revision-notice",state.requestRevisionNotice);notice.setAttribute("role","status");form.append(notice);}
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      ask();
    });
    composer = el("textarea");
    composer.setAttribute("aria-label", "Ask about your source");
    composer.placeholder = state.alternativeGenerationDraft?"Describe the alternatives to explore…":state.continuationContext?"Guide the next investigation decision…":state.checkContext?"What should these checks establish?":state.groupRevision?"What should change in this group?":({ask:"Ask about this source…",plan:"Describe the outcome to plan…",build:"Describe the change…",review:"What should this source review focus on?"})[state.intent];
    composer.rows = assistantSurface ? 2 : 3;
    composer.maxLength = 6000;
    composer.value = state.question;
    composer.disabled = state.running || Boolean(activeConversation()?.archived) || state.conversations?.storage?.status === "unavailable";
    composer.addEventListener("input", () => {
      state.question = composer.value;
      markAssistantDraftEdited(false);saveView();
      updateAskButton();
    });
    composer.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        ask();
      }
    });
    form.append(composer);
    const footer = el("div", "composer-footer");
    footer.append(el("span", "composer-guidance", requestBlocker()));
    const setupRequired = !state.provider?.configured && !state.running;
    const submit = button(
      state.running ? "Stop" : setupRequired ? "Set up AI" : state.alternativeGenerationDraft?"Generate alternatives":state.continuationContext?"Ask next step":state.checkContext?"Suggest checks":state.groupRevision?"Propose revision":({ask:"Ask",plan:"Create plan",build:"Propose change",review:"Review source"})[state.intent],
      state.running ? stop : setupRequired ? () => action("foundation.configureAI") : ask,
      state.running ? "button stop" : "button primary ask-submit",
      state.running ? "stop" : setupRequired ? "spark" : "send",
    );
    submit.id = setupRequired ? "assistant-setup" : "ask-submit";
    submit.disabled = setupRequired ? false : state.running ? false : !canAsk();
    submit.dataset.artifactFocus = "assistant-submit";
    submit.setAttribute("aria-disabled", String(submit.disabled || state.turns.at(-1)?.state === "stopping"));
    if (state.turns.at(-1)?.state === "stopping" && state.running) submit.textContent = "Stopping…";
    footer.append(submit);
    form.append(footer);
    if (activeConversation()?.archived) {
      const archived = el("div", "archived-conversation-note");
      archived.append(el("span", "", "Restore this conversation to send another request."), button("Restore conversation", () => conversationAction("restore", activeConversation().id), "button small"));
      conversation.append(archived);
    }
    conversation.append(form);
    layout.append(conversation);
    if (!assistantSurface) layout.append(side);
    wrap.append(layout);
    const sr = el("span", "sr-only");
    sr.setAttribute("role", "status");
    sr.textContent = state.running
      ? state.turns.at(-1)?.state === "stopping" ? "Stopping the request." : "Foundation is answering your question."
      : state.turns.at(-1)?.state === "stopped"
        ? "Answer stopped."
        : state.turns.at(-1)?.state === "complete"
          ? "Answer complete."
          : "";
    wrap.append(sr);
    return wrap;
  }
  // Keep plain answer text and its passive ancestors in their connected parent.
  // All surrounding controls, warnings and source evidence are freshly built.
  const assistantRenderOwners = new WeakMap();
  function copyPassiveAttributes(current, next) {
    for (const attribute of [...current.attributes]) if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
    for (const attribute of next.attributes) if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
  }
  function passiveBranch(root, leaf) {
    const nodes = [];
    for (let node = leaf; node; node = node.parentElement) { nodes.push(node); if (node === root) return nodes; }
    return null;
  }
  function compatiblePassiveBranches(currentRoot, nextRoot, currentLeaf, nextLeaf) {
    const current = passiveBranch(currentRoot, currentLeaf), next = passiveBranch(nextRoot, nextLeaf);
    return current && next && current.length === next.length && current.every((node,index)=>node.tagName === next[index].tagName && node.className === next[index].className) ? {current,next} : null;
  }
  function preservePassiveBranch(currentRoot, nextRoot, currentLeaf, nextLeaf) {
    const branches = compatiblePassiveBranches(currentRoot,nextRoot,currentLeaf,nextLeaf); if (!branches) return false;
    const {current,next} = branches;
    copyPassiveAttributes(currentLeaf, nextLeaf);
    for (let index = 1; index < current.length; index++) {
      const parent = current[index], retained = current[index-1], fresh = next[index], marker = next[index-1];
      const children = [...fresh.childNodes], split = children.indexOf(marker);
      // Removing only siblings keeps the retained branch connected throughout
      // the commit, including native text selection and citation focus.
      for (const child of [...parent.childNodes]) if (child !== retained) child.remove();
      for (const child of children.slice(0,split)) parent.insertBefore(child, retained);
      for (const child of children.slice(split+1)) parent.append(child);
      copyPassiveAttributes(parent, fresh);
    }
    return true;
  }
  function retainPlainResponse(current, next) {
    if (current.dataset.plainResponse !== "true" || next.dataset.plainResponse !== "true") return next;
    const oldAnswer = current.querySelector(".answer-text"), newAnswer = next.querySelector(".answer-text");
    const before = answerRenderBasis.get(oldAnswer), after = answerRenderBasis.get(newAnswer);
    if (!before || !after) return next;
    // Content, not timestamps, determines whether citation closures remain valid.
    // A changed answer updates its leaf while preserving the passive row chain.
    const unchanged = before.answer === after.answer && before.citations === after.citations && before.runtime === after.runtime;
    if (!preservePassiveBranch(current, next, oldAnswer, newAnswer)) return next;
    if (!unchanged) oldAnswer.replaceChildren(...newAnswer.childNodes);
    answerRenderBasis.set(oldAnswer, after);
    return current;
  }
  function commitAssistant(next) {
    const owner = JSON.stringify([state.project?.id || null,state.conversations?.activeId || null,state.features?.activeId || null,state.trusted]);
    const current = otherSlot.firstElementChild, freshResponses = next.querySelector(".assistant-responses"), oldResponses = current?.querySelector(".assistant-responses");
    if (current?.matches(".assistant-page") && assistantRenderOwners.get(current) === owner && oldResponses && freshResponses && compatiblePassiveBranches(current,next,oldResponses,freshResponses)) {
      const previous = new Map([...oldResponses.children].filter(node=>node.dataset.turnId).map(node=>[node.dataset.turnId,node]));
      const desired = [...freshResponses.children].map(node=>previous.has(node.dataset.turnId) ? retainPlainResponse(previous.get(node.dataset.turnId),node) : node);
      let cursor = oldResponses.firstChild;
      for (const node of desired) { if (node !== cursor) oldResponses.insertBefore(node,cursor); cursor = node.nextSibling; }
      while (cursor) { const next = cursor.nextSibling; cursor.remove(); cursor = next; }
      if (preservePassiveBranch(current,next,oldResponses,freshResponses)) { responseRegion = oldResponses; return; }
    }
    assistantRenderOwners.set(next,owner); otherSlot.replaceChildren(next);
  }
  function updateAskButton() {
    const b = document.getElementById("ask-submit");
    if (b && !state.running) { b.disabled = !canAsk(); b.setAttribute("aria-disabled", String(b.disabled)); }
  }
  function rememberFocus() {
    for(const output of document.querySelectorAll(".execution-output[data-execution-id]"))if(output.clientHeight)executionOutputScroll.set(output.dataset.executionId,output.scrollTop);
    return {
      focused: document.hasFocus(),
      workspace: document.activeElement?.dataset.workspaceFocus,
      artifact: document.activeElement?.dataset.artifactFocus,
      composer: document.activeElement === composer,
      start: composer?.selectionStart,
      end: composer?.selectionEnd,
      context: document.activeElement?.dataset.contextPath,
      mode: document.activeElement?.dataset.mode,
      design: document.activeElement?.dataset.designFocus,
      designCursor: document.activeElement?.selectionStart,
      designCursorEnd: document.activeElement?.selectionEnd,
      designCursorDirection: document.activeElement?.selectionDirection,
    };
  }
  function restoreFocus(previous) {
    for(const output of document.querySelectorAll(".execution-output[data-execution-id]"))if(output.clientHeight)output.scrollTop=executionOutputScroll.get(output.dataset.executionId) || 0;
    // A retained sibling webview keeps its last activeElement while the editor
    // owns the keyboard. Background hydration must not reclaim that focus.
    if (!previous.focused) { state.historyFocus = false; return; }
    if (state.historyFocus) {
      state.historyFocus = false;
      root.querySelector('[data-artifact-focus="conversation-history"]')?.focus({preventScroll:true});
    } else if (previous.workspace) {
      root.querySelector(`[data-workspace-focus="${CSS.escape(previous.workspace)}"]`)?.focus({preventScroll:true});
    } else if (previous.artifact) {
      const scope = artifactDialog?.open ? artifactDialog : root;
      const candidate = scope.querySelector(`[data-artifact-focus="${CSS.escape(previous.artifact)}"]`);
      (candidate && !candidate.disabled ? candidate : artifactDialog?.open ? artifactDialog.querySelector(".artifact-close") : root.querySelector(".composer textarea:not(:disabled)"))?.focus({preventScroll:true});
    } else if (previous.composer && !state.running && composer?.isConnected) {
      composer.focus({ preventScroll: true });
      if (previous.start !== undefined)
        composer.setSelectionRange(previous.start, previous.end);
    } else if (previous.context)
      root
        .querySelector(`[data-context-path="${CSS.escape(previous.context)}"]`)
        ?.focus({ preventScroll: true });
    else if (previous.design) {
      const input = (artifactDialog?.open?artifactDialog:root).querySelector(`[data-design-focus="${CSS.escape(previous.design)}"]`);
      input?.focus({ preventScroll: true });
      if (input && Number.isInteger(previous.designCursor) && typeof input.setSelectionRange === "function")
        input.setSelectionRange(previous.designCursor, previous.designCursorEnd ?? previous.designCursor, previous.designCursorDirection || "none");
    } else if (previous.mode)
      root
        .querySelector(`[data-mode="${previous.mode}"]`)
        ?.focus({ preventScroll: true });
  }
  // Keep the native activation target connected until its key/pointer gesture
  // completes. State and action guards still update immediately; only DOM
  // commits coalesce. Never synthesize or replay a click after publication.
  let activeActivation = null, queuedActivationRender = null, activationReleaseTimer = null;
  function activationOwner(control) {
    if(control?.dataset.knowledgeAction){const draft=knowledgeDraft(),item=knowledgeItems().find(value=>value.key===control.dataset.knowledgeKey || value.key===draft?.selectedKey);return JSON.stringify({project:state.project?.id,trusted:state.trusted,mode:state.mode,action:control.dataset.knowledgeAction,key:control.dataset.knowledgeKey,selected:draft?.selectedKey,digest:item?.digest,status:item?.status,canShare:item?.canShare,feature:state.features?.activeId,conversation:state.conversations?.activeId,pending:Boolean(pendingKnowledgeContext)});}
    if (control?.matches(".activity-tabs > button[data-mode]")) return JSON.stringify({project:state.project?.id,feature:state.features?.activeId,mode:state.mode,trusted:state.trusted,targetMode:control.dataset.mode});
    if (control?.dataset.lazyDisclosure) return JSON.stringify({project:state.project?.id,feature:state.features?.activeId,mode:state.mode,trusted:state.trusted,disclosure:control.dataset.lazyDisclosure});
    const submit = control?.dataset.artifactFocus === "assistant-submit";
    const owner = {project:state.project?.id || null,conversation:state.conversations?.activeId || null,
      feature:state.features?.activeId || null,mode:state.mode,trusted:state.trusted};
    if (submit) {
      owner.action = state.running ? "stop" : state.provider?.configured ? "send" : "setup";
      if (state.running) owner.request = state.turns.at(-1)?.requestId || null;
      else {
        owner.provider = {configured:state.provider?.configured,provider:state.provider?.provider,providerKind:state.provider?.providerKind,model:state.provider?.model,
          transport:state.provider?.transport,baseUrl:state.provider?.baseUrl,endpoint:state.provider?.endpoint};
        if (state.provider?.configured) {
          const files = sourceFiles();
          Object.assign(owner, {question:state.question,intent:state.intent,featureRevision:state.features?.revision,sendable:canAsk(),
            context:state.context.map(path=>({path,revision:files.find(file=>file.path===path)?.revision || null,dirty:state.dirtyPaths.includes(path)})),
            decisions:state.decisionContext,decisionSnapshot:selectedDecisionSnapshot(),issues:state.issueContext,issueSnapshot:selectedIssueSnapshot(),task:state.featureTaskIncluded,runtimeSession:state.runtime?.session,
            runtimeEvidence:state.runtimeObservationIds.map(id=>state.runtime?.observations?.find(item=>item.id===id) || {id,unavailable:true}),
            plan:state.planContext,request:state.requestRevision,group:state.groupRevision,checks:state.checkContext,
            investigation:state.investigationContext,continuation:state.continuationContext,alternativeGeneration:selectedAlternativeGeneration()});
        }
      }
    } else if(control?.dataset.aiAlternatives==="explore"){Object.assign(owner,{intent:state.intent,running:state.running,draft:state.alternativeGenerationDraft});
    } else if (control?.dataset.contextPath) {
      const path = control.dataset.contextPath;
      Object.assign(owner,{path,revision:sourceFiles().find(file=>file.path===path)?.revision,selected:state.context.includes(path),
        dirty:state.dirtyPaths.includes(path),featureRevision:state.features?.revision,running:state.running});
    } else if(control?.dataset.contextIssue){const item=issueView()?.records.find(value=>value.record.id===control.dataset.contextIssue);Object.assign(owner,{issue:control.dataset.contextIssue,digest:item?.digest,canShare:item?.canShare,assessment:item?.status,selected:state.issueContext,running:state.running});
    } else if(control?.dataset.contextDecision){const item=decisionView()?.records.find(value=>value.record.id===control.dataset.contextDecision);Object.assign(owner,{decision:control.dataset.contextDecision,digest:item?.digest,canShare:item?.canShare,selected:state.decisionContext,running:state.running});
    } else if (control?.dataset.designFocus?.startsWith("intent-")) Object.assign(owner,{intent:state.intent,running:state.running});
    return JSON.stringify(owner);
  }
  function activationControl(target) {
    if (!(target instanceof Element)) return null;
    const activity = target.closest(".workspace-header .activity-tabs > button[data-mode]");
    if (activity && root.contains(activity) && !activity.disabled) return activity;
    const disclosure = target.closest("summary[data-lazy-disclosure]");
    if (disclosure && root.contains(disclosure)) return disclosure;
    const knowledge=target.closest("button[data-knowledge-action]");
    if(knowledge && root.contains(knowledge) && !knowledge.disabled)return knowledge;
    if (state.mode !== "Assistant") return null;
    // Limit preservation to controls with a complete local ownership contract.
    // Review and tool controls retain their own existing revision guards.
    let control = target.closest('button[data-artifact-focus="assistant-submit"],summary[aria-label="Request context and model"],input[data-context-path],input[data-context-decision],input[data-context-issue],input[data-ai-alternatives="explore"],button[data-design-focus^="intent-"]');
    if (!control) {
      const associated = target.closest("label")?.control;
      if (associated?.matches("input[data-context-path],input[data-context-decision],input[data-context-issue],input[data-ai-alternatives=\"explore\"]")) control = associated;
    }
    return control && root.contains(control) && !control.disabled ? control : null;
  }
  function activationContains(activation, target) {
    return activation.control.contains(target) || target instanceof Element && target.closest("label")?.control === activation.control;
  }
  function captureActivationPreference(current) {
    if (!current.cancelled && current.control.isConnected && current.control.dataset.lazyDisclosure)
      disclosureState.set(current.control.dataset.lazyDisclosure, current.control.parentElement.open);
    // A summary's native toggle notification is a separate task. Read its
    // completed DOM state without replaying the action, including when another
    // real gesture starts before the release timer has run.
    if (!current.cancelled && current.control.isConnected && current.control.matches('summary[aria-label="Request context and model"]')) {
      state.sidebarContextOpen = current.control.parentElement.open; saveView();
    }
  }
  function releaseActivation(cancelled = false) {
    const current = activeActivation;
    if (!current) return;
    current.cancelled ||= cancelled;
    clearTimeout(activationReleaseTimer);
    // Space's click/default action follows keyup; pointer click follows up.
    // A task boundary lets the browser finish that activation before rendering.
    activationReleaseTimer = setTimeout(() => {
      if (activeActivation !== current) return;
      captureActivationPreference(current);
      activeActivation = null; activationReleaseTimer = null;
      const pending = queuedActivationRender; queuedActivationRender = null;
      if (pending === "full") render(); else if (pending) renderAssistant();
    }, 0);
  }
  function deferActivationRender(kind) {
    if (!activeActivation) return false;
    if (activeActivation.cancelled || !activeActivation.control.isConnected || activationOwner(activeActivation.control) !== activeActivation.owner) {
      activeActivation.cancelled = true; queuedActivationRender = null; return false;
    }
    if (kind === "full" || !queuedActivationRender) queuedActivationRender = kind;
    return true;
  }
  function beginActivation(event, kind, key) {
    if (!event.isTrusted) return;
    const control = activationControl(event.target);
    if (activeActivation && control !== activeActivation.control) {
      captureActivationPreference(activeActivation);
      activeActivation.superseded = true;
      releaseActivation(true);
    }
    if (!control) return;
    clearTimeout(activationReleaseTimer); activationReleaseTimer = null;
    activeActivation = {control,kind,key,owner:activationOwner(control),cancelled:false};
  }
  document.addEventListener("keydown", event => {
    if (!event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey && [" ","Enter"].includes(event.key)) beginActivation(event,"key",event.key);
  }, true);
  document.addEventListener("keyup", event => {
    if (event.isTrusted && activeActivation?.kind === "key" && event.key === activeActivation.key) releaseActivation();
  }, true);
  document.addEventListener("pointerdown", event => {
    if (event.isPrimary && event.button === 0) beginActivation(event,"pointer",event.pointerId);
  }, true);
  document.addEventListener("pointerup", event => {
    if (event.isTrusted && activeActivation?.kind === "pointer" && event.pointerId === activeActivation.key)
      releaseActivation(!activationContains(activeActivation, event.target));
  }, true);
  document.addEventListener("click", event => {
    if (!event.isTrusted || !activeActivation) return;
    const current = activeActivation;
    // A subsequent native gesture outside this narrow scope is independent;
    // the previous guard must never cancel its default action.
    if (current.superseded && !activationContains(current, event.target)) return;
    if (current.cancelled || !activationContains(current, event.target) || activationOwner(current.control) !== current.owner) {
      event.preventDefault(); event.stopImmediatePropagation(); releaseActivation(true);
    } else releaseActivation();
  }, true);
  document.addEventListener("pointercancel", () => releaseActivation(true), true);
  document.addEventListener("focusout", event => {
    if (activeActivation?.kind === "key" && activeActivation.control === event.target) releaseActivation(true);
  }, true);
  window.addEventListener("blur", () => releaseActivation(true));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState !== "visible") releaseActivation(true); });
  function renderAssistant() {
    if (deferActivationRender("assistant")) return;
    captureLazyDisclosures();
    if (state.mode !== "Assistant") return;
    const main = document.getElementById("foundation-content");
    if (!main) return;
    const focus = rememberFocus();
    const scroller = assistantSurface ? responseRegion : main;
    const top = scroller?.scrollTop || 0;
    const follow = scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 24;
    commitAssistant(assistant());
    const nextScroller = assistantSurface ? responseRegion : main;
    if (nextScroller) nextScroller.scrollTop = follow ? nextScroller.scrollHeight : top;
    updateArtifactDialog();refreshPlanControls();
    restoreFocus(focus);
  }
  function render() {
    if (deferActivationRender("full")) return;
    captureLazyDisclosures();
    if(pendingIssueReveal){const reveal=pendingIssueReveal;pendingIssueReveal=null;if(reveal.projectId===state.project?.id&&reveal.featureId===activeFeature()?.id)for(const key of [`feature/${reveal.featureId}/runtime`,`runtime-workspace/${reveal.featureId}/history`,`run/${reveal.runId}`])disclosureState.set(key,true);}
    const previousFocus = rememberFocus();
    if (!mainSurface) {
      chromeSlot = el("div", "workspace-chrome");
      mainSurface = el("main", "workspace-content"); mainSurface.id = "foundation-content";
      designSlot = el("div", "workspace-design-slot");
      alternativesSlot = el("section", "workspace-alternatives-slot runtime-studio");
      otherSlot = el("div", "workspace-page-current");
      footerSlot = el("footer", "workspace-footer");
      mainSurface.append(alternativesSlot, designSlot, otherSlot); root.replaceChildren(chromeSlot, mainSurface, ...assistantSurface ? [] : [footerSlot]);
      layoutObserver = new ResizeObserver(applyStudioLayout); layoutObserver.observe(mainSurface);
    }
    const previousMode = mainSurface.dataset.mode;
    const top = mainSurface.scrollTop;
    const conversationTop = responseRegion?.scrollTop || 0;
    chromeSlot.replaceChildren(...assistantSurface ? [] : header());
    if(state.error && state.mode !== "Refine") {
      const alert = note(state.error,"error"); alert.classList.add("error-banner"); alert.setAttribute("role","alert");
      const dismiss = button("", () => { state.error = ""; render(); }, "icon-button", "close"); dismiss.setAttribute("aria-label", "Dismiss error"); alert.append(dismiss); chromeSlot.append(alert);
    }
    mainSurface.dataset.mode = state.mode;
    mainSurface.setAttribute("aria-label", `${state.mode} workspace`);
    const available = state.project && state.trusted && (state.activeFile || ["Review","Assistant"].includes(state.mode) || state.mode === "Refine" && state.runtime || state.mode === "Understand" && (state.features || knowledgeOpenProjectId===state.project?.id));
    const samePreview = state.trusted && state.project?.id === renderedDesignProject && renderedPreviewMode === (isRuntimePreview() ? "runtime" : "sandbox") && (isRuntimePreview()
      ? (state.runtime?.session || null) === renderedDesignSession && (state.runtime?.viewId || null) === renderedRuntimeViewId && (state.runtime?.url || null) === renderedRuntimeURL && Boolean(runtimeURL() && state.runtime?.session) === Boolean(designFrame)
      : (state.design?.session || null) === renderedDesignSession && Boolean(state.design?.html) === Boolean(designFrame));
    if (!samePreview && designSlot.childNodes.length) {
      designResizeObserver?.disconnect(); designSlot.replaceChildren(); designFrame = null; designSettingsSignature = "";
    }
    designSlot.hidden = state.mode !== "Refine" || !available;
    designSlot.inert = designSlot.hidden;
    otherSlot.hidden = !designSlot.hidden;
    if (!designSlot.hidden) {
      if (!designSlot.childNodes.length) designSlot.append(refine());
      else updateDesignView();
    } else if (available && state.mode === "Assistant") commitAssistant(assistant());
    else { const next=!available ? emptyState() : state.mode === "Review" ? review() : understand();if(otherSlot.firstElementChild!==next)otherSlot.replaceChildren(next);responseRegion = null; composer = null; }
    updateAlternativeCanvas();
    if(designFrame && isRuntimePreview())designFrame.toggleAttribute("data-foundation-runtime-canvas",!designSlot.hidden);
    const status = el("span"); status.append(el("i","status-dot"), document.createTextNode(state.project ? `${state.project.files.length}${state.project.truncated ? "+" : ""} ${state.project.files.length === 1 && !state.project.truncated ? "file" : "files"} indexed` : "Native workspace"));
    footerSlot.replaceChildren(status, el("span","footer-note",state.status || ""));
    mainSurface.scrollTop = previousMode === state.mode ? top : scrollPositions.get(state.mode) || 0;
    if (assistantSurface && responseRegion) responseRegion.scrollTop = conversationTop;
    applyStudioLayout(); sendDesignSettings(); updateArtifactDialog(); refreshPlanControls();restoreFocus(previousFocus);
    if(knowledgeFocusSearch && knowledgeOpenProjectId===state.project?.id && state.mode==="Understand"){knowledgeFocusSearch=false;knowledgeCache?.search.focus({preventScroll:true});}
  }
  window.addEventListener("message", (event) => {
    let message = event.data;
    if(alternativeFrame?.contentWindow && event.source===alternativeFrame.contentWindow){receiveAlternativeWitness(event);return;}
    // Project source runs inside an opaque sandbox. Its messages are never host commands.
    if (designFrame?.contentWindow && event.source === designFrame.contentWindow) {
      if (isRuntimePreview()) return; // Runtime observations are authenticated by the host service.
      if (!message || message.channel !== "foundation-design" || message.session !== state.design?.session) return;
      if (message.type === "ready") {
        state.design.observed = true;
        sendDesignSettings(true);
        vscode.postMessage({ type: "designObserved", session: message.session, event: "ready" });
        updateDesignView();
      } else if (message.type === "selection" && state.mode === "Refine" && message.selection && typeof message.selection === "object") {
        const candidate = message.selection;
        const known = !candidate.path || state.project?.files.some((file) => file.path === candidate.path);
        if (!known) return;
        state.designSelection = candidate;
        state.unmappedMessage = "";
        vscode.postMessage({ type: "designObserved", session: message.session, event: "selection", intent: message.intent === "select" ? "select" : "measure", selection: candidate });
        updateDesignView();
      } else if (message.type === "unmapped" && state.mode === "Refine") {
        state.designSelection = null;
        state.unmappedMessage = "This element has no validated explicit source mapping. Select an instrumented component or open its source in the editor.";
        vscode.postMessage({ type: "designObserved", session: message.session, event: "selection", selection: null });
        updateDesignView();
      } else if (message.type === "settingsApplied") {
        const skipped = Number.isInteger(message.skipped) && message.skipped > 0 ? Math.min(message.skipped, 160) : 0;
        if (skipped !== state.skippedExperiments) {
          state.skippedExperiments = skipped;
          root.querySelector(".design-status-region")?.replaceWith(designStatus());
        }
      } else if (message.type === "error") {
        const error = String(message.error || "The preview could not render.").slice(0, 1000);
        state.design.error = error;
        vscode.postMessage({ type: "designObserved", session: message.session, event: "error", error });
        updateDesignView();
      }
      return;
    }
    // Code OSS forwards extension messages from its same-origin outer frame,
    // but its API bootstrap replaces window.parent with window. Check the real
    // message origin instead of that rewritten reference. Opaque project frames
    // are handled above and can never enter this host-message path.
    if (!event.origin || event.origin === "null" || event.origin !== window.location.origin) return;
    if (!message || typeof message.type !== "string") return;
    if (message.history && historyReceiver) {
      const result = historyReceiver.receive(message.history);
      if (!result.ok) {
        if (result.ignored) return;
        // Keep the last visible history but block history-dependent actions
        // until the owning host sends a complete replacement. Missing is never
        // interpreted as an empty conversation or an empty observation list.
        for (const key of ["conversations", "runtimeWorkspace"]) if (state[key])
          state[key] = { ...state[key], storage: { status: "unavailable", message: "Restoring local history…" } };
        if (result.requestResync) vscode.postMessage({ type: "historyResync" });
        render(); return;
      }
      message = { ...message, ...result.values };
    }
    if(message.type==="revealKnowledge"){if(assistantSurface || !state.trusted || message.projectId!==state.project?.id)return;knowledgeOpenProjectId=state.project.id;state.mode="Understand";knowledgeNotice="";knowledgeFocusSearch=true;saveView();render();return;}
    if(message.type==="knowledgeContextPrepared"){receiveKnowledgeContext(message);return;}
    if(message.type==="knowledgeContextResult"){const pending=pendingKnowledgeContext;if(!pending || ["projectId","kind","id","digest"].some(key=>message[key]!==pending[key]))return;pendingKnowledgeContext=null;knowledgeNotice=message.error || "Added to Assistant context. Review it before sending.";render();return;}
    if(message.type==="aiAlternativeResult"){if(message.projectId!==state.project?.id || !pendingAIAlternative || message.artifactId!==pendingAIAlternative.artifactId || message.candidateId!==pendingAIAlternative.candidateId)return;pendingAIAlternative=null;if(message.error)state.error=message.error;renderAssistant();return;}
    if(message.type==="investigationContinuationPrepared" || message.type==="investigationContinuationResult") {
      const preparing=message.type==="investigationContinuationPrepared" || ["prepare","refresh"].includes(message.action),pending=preparing?pendingContinuation:pendingContinuationAction;
      if(!pending || !matchingAssistantIdentity(pending,assistantIdentity()) || !matchingAssistantIdentity(message,pending) || message.featureRevision!==pending.featureRevision || message.requestId!==pending.requestId || message.prepareId!==pending.prepareId || preparing && pending.generation!==assistantDraftGeneration || !preparing && message.action!==pending.action)return;
      if(message.type==="investigationContinuationResult"){
        if(preparing){pendingContinuation=null;state.continuationRefreshed=false;state.continuationNotice=message.error || "The checkpoint could not be prepared. Your draft is preserved.";}else{pendingContinuationAction=null;if(message.error)continuationErrors.set(pending.requestId,String(message.error).slice(0,1000));}
        saveView();renderAssistant();return;
      }
      const value=artifacts.investigationContextSnapshot(message.investigationContext),basis=value && artifacts.investigationContextBasis(activeConversation(),pending.requestId);
      if(!value || !basis || value.parentRequestId!==pending.requestId || Object.keys(basis).some(key=>JSON.stringify(value[key])!==JSON.stringify(basis[key])) || value.result.projectId!==pending.projectId || value.result.featureId!==pending.featureId || value.result.featureRevision!==pending.featureRevision || !Array.isArray(message.context) || message.context.length!==1 || message.context[0]?.path!==value.result.anchor.path || message.context[0]?.revision!==value.result.anchor.revision || typeof message.prompt!=="string" || message.prompt.length>6000)return;
      clearContinuation(false);detachRequestRevision();markAssistantDraftEdited();state.decisionContext=[];state.issueContext=[];state.continuationContext=value;state.continuationRefreshed=true;state.intent="plan";state.context=[value.result.anchor.path];state.contextInitialized=true;state.planContext=null;state.featureTaskIncluded=false;state.runtimeObservationIds=[];state.contextUnavailable=[];
      if(!state.question.trim())state.question=message.prompt;requestAssistantSources();closeArtifact();saveView();renderAssistant();composer?.focus();return;
    }
    if(message.type==="prepareSourceInvestigation") {prepareSourceInvestigation(message);return;}
    if(message.type==="sourceInvestigationPrepared" || message.type==="sourceInvestigationResult") {
      const pending=pendingSourceInvestigation;
      if(!pending || pending.generation!==assistantDraftGeneration || !matchingAssistantIdentity(pending,assistantIdentity()) || !matchingAssistantIdentity(message,pending) || message.featureRevision!==pending.featureRevision || message.prepareId!==pending.prepareId)return;
      if(message.type==="sourceInvestigationResult"){pendingSourceInvestigation=null;state.investigationNotice=typeof message.error==="string"?message.error.slice(0,1000):"Investigation could not be prepared. Return to Relationships and try again.";state.investigationRefreshed=false;saveView();renderAssistant();return;}
      const result=artifacts.sourceInvestigationSnapshot(message.sourceInvestigation);
      if(!result || result.projectId!==pending.projectId || result.featureId!==pending.featureId || result.featureRevision!==pending.featureRevision || result.anchor.path!==pending.anchorPath || !Array.isArray(message.context) || message.context.length!==1 || message.context[0]?.path!==result.anchor.path || message.context[0]?.revision!==result.anchor.revision || typeof message.prompt!=="string" || message.prompt.length>6000)return;
      clearSourceInvestigation(false);detachRequestRevision();markAssistantDraftEdited();state.decisionContext=[];state.issueContext=[];state.investigationContext=result;state.investigationRefreshed=true;state.intent="ask";state.context=[result.anchor.path];state.contextInitialized=true;state.planContext=null;state.featureTaskIncluded=false;state.runtimeObservationIds=[];state.contextUnavailable=[];
      if(!state.question.trim())state.question=message.prompt;requestAssistantSources();closeArtifact();saveView();renderAssistant();composer?.focus();return;
    }
    if(message.type==="checkSuggestionPrepared" || message.type==="checkSuggestionResult") {
      if(message.type==="checkSuggestionPrepared" || message.action==="prepare"){
        const pending=pendingCheckSuggestion;
        if(!pending || pending.generation!==assistantDraftGeneration || !matchingAssistantIdentity(pending,assistantIdentity()) || !matchingAssistantIdentity(message,pending) || message.prepareId!==pending.prepareId || message.requestId!==pending.requestId)return;
        if(message.type==="checkSuggestionResult"){pendingCheckSuggestion=null;checkSuggestionErrors.set(`group/${pending.changeSetId}`,typeof message.error==="string"?message.error.slice(0,1000):"Supported checks could not be prepared. Try again.");saveView();renderAssistant();return;}
        const descriptor=validateCheckContext(message.checkContext),shared=artifacts.groupRevisionSources(descriptor,activeConversation()),record=state.executionSession?.current,group=state.changeSetSession?.current;
        if(!descriptor || descriptor.requestId!==pending.requestId || descriptor.conversationId!==pending.conversationId || descriptor.groupId!==pending.changeSetId || descriptor.groupRevision!==pending.expectedGroupRevision || descriptor.groupDigest!==pending.groupDigest || descriptor.snapshotRevision!==pending.snapshotRevision || JSON.stringify(descriptor.tasks)!==JSON.stringify(pending.tasks) || !shared.valid || group?.id!==descriptor.groupId || group.revision!==descriptor.groupRevision || group.status!=="proposed" || record?.id!==pending.executionId || record.revision!==pending.expectedExecutionRevision || record.status!=="ready" || !Array.isArray(message.context) || message.context.length!==shared.parent.context.length || message.context.some((file,index)=>["id","path","revision","source","lines"].some(key=>file?.[key]!==shared.parent.context[index]?.[key])) || !Array.isArray(message.sharedFiles) || message.sharedFiles.length!==shared.files.length || message.sharedFiles.some((file,index)=>{const source=shared.files[index];return file.path!==source.path || file.source!==source.source || file.origin!==source.origin || file.lines!==source.lines || typeof file.revision!=="string" || source.origin==="saved" && file.revision!==source.revision;}) || typeof message.prompt!=="string" || message.prompt.length>6000)return;
        pendingCheckSuggestion=null;detachRequestRevision();markAssistantDraftEdited();state.decisionContext=[];state.issueContext=[];state.checkContext=descriptor;state.intent="plan";state.context=message.context.map(file=>file.path);state.contextInitialized=true;state.planContext=null;state.featureTaskIncluded=false;state.runtimeObservationIds=[];state.contextUnavailable=[];
        if(!state.question.trim())state.question=message.prompt;requestAssistantSources();closeArtifact();saveView();renderAssistant();composer?.focus();return;
      }
      const pending=pendingCheckDecision;
      if(!pending || !matchingAssistantIdentity(pending,assistantIdentity()) || message.action!==pending.action || message.projectId!==pending.projectId || message.conversationId!==pending.conversationId || message.requestId!==pending.requestId || message.artifactId!==pending.artifactId)return;
      const turn=state.turns.find(turn=>turn.requestId===pending.requestId && turn.checkSuggestion?.id===pending.artifactId);pendingCheckDecision=null;
      if(!turn)return;
      if(message.passed!==true)checkSuggestionErrors.set(checkSuggestionKey(turn),typeof message.error==="string"?message.error.slice(0,1000):"The check decision could not be saved. Your selection is preserved.");
      else if(message.action==="open"){
        const accepted=checkSuggestionView(turn).accepted;if(accepted && message.planId===accepted.id && message.changeSetId===accepted.groupId){checkPlanSelectedIds.set(accepted.groupId,accepted.id);openArtifact({kind:"change-set",changeSetId:accepted.groupId});}
      }
      saveView();renderAssistant();return;
    }
    if(message.type==="groupRevisionPrepared" || message.type==="groupRevisionResult") {
      const pending=pendingGroupRevision;
      if(!pending || pending.generation!==assistantDraftGeneration || !matchingAssistantIdentity(pending,assistantIdentity()) || !matchingAssistantIdentity(message,pending) || message.prepareId!==pending.prepareId || message.requestId!==pending.requestId || message.groupId!==pending.groupId || message.expectedGroupRevision!==pending.expectedGroupRevision)return;
      if(message.type==="groupRevisionResult"){pendingGroupRevision=null;groupRevisionErrors.set(pending.groupId,typeof message.error==="string"?message.error.slice(0,1000):"This group could not be prepared. Try again.");saveView();renderAssistant();return;}
      const descriptor=validateGroupRevision(message.groupRevision),shared=artifacts.groupRevisionSources(descriptor,activeConversation()),group=state.changeSetSession?.current;
      if(!descriptor || descriptor.requestId!==pending.requestId || descriptor.groupId!==pending.groupId || descriptor.groupRevision!==pending.expectedGroupRevision || descriptor.conversationId!==pending.conversationId || !shared.valid || group?.id!==descriptor.groupId || group.revision!==descriptor.groupRevision || group.status!=="proposed" || !Array.isArray(message.files) || message.files.length!==shared.parent.context.length || message.files.some((file,index)=>file?.path!==shared.parent.context[index].path || file.revision!==shared.parent.context[index].revision) || !Array.isArray(message.sharedFiles) || message.sharedFiles.length!==shared.files.length || message.sharedFiles.some((file,index)=>{const source=shared.files[index];return file.path!==source.path || file.origin!==source.origin || file.source!==source.source || file.lines!==source.lines || typeof file.revision!=="string" || source.origin==="saved" && file.revision!==source.revision;}))return;
      pendingGroupRevision=null;detachRequestRevision();markAssistantDraftEdited();state.decisionContext=[];state.issueContext=[];state.groupRevision=descriptor;state.intent="build";state.context=message.files.map(file=>file.path);state.contextInitialized=true;state.planContext=null;state.featureTaskIncluded=false;state.runtimeObservationIds=[];state.contextUnavailable=[];
      requestAssistantSources();closeArtifact();saveView();renderAssistant();composer?.focus();return;
    }
    if(message.type==="requestRevisionPrepared" || message.type==="requestRevisionResult") {
      const pending=pendingRequestRevision;
      if(!pending || pending.generation!==assistantDraftGeneration || !matchingAssistantIdentity(pending,assistantIdentity()) || !matchingAssistantIdentity(message,pending) || message.prepareId!==pending.prepareId || message.requestId!==pending.requestId)return;
      if(message.type==="requestRevisionResult") {
        pendingRequestRevision=null;requestRevisionErrors.set(pending.requestId,typeof message.error==="string"?message.error.slice(0,1000):"This request could not be prepared. Try again.");saveView();renderAssistant();return;
      }
      const descriptor=validateRequestRevision(message.requestRevision),parent=activeConversation()?.turns.find(turn=>turn.requestId===pending.requestId);
      if(!descriptor || descriptor.requestId!==pending.requestId || descriptor.conversationId!==pending.conversationId || !parent || !["complete","stopped","failed","interrupted"].includes(parent.state) || parent.planContext || message.intent!==normalizeIntent(parent.intent) || message.prompt!==parent.question || !Array.isArray(message.files) || message.files.length!==parent.context.length || message.files.some((file,index)=>file?.path!==parent.context[index].path || file.revision!==parent.context[index].revision))return;
      pendingRequestRevision=null;detachRequestRevision();markAssistantDraftEdited();state.decisionContext=[];state.issueContext=[];state.requestRevision=descriptor;state.requestRevisionNotice="";state.intent=message.intent;state.context=message.files.map(file=>file.path);state.contextInitialized=true;state.featureTaskIncluded=false;state.runtimeObservationIds=[];state.planContext=null;state.contextUnavailable=[];
      if(!state.question.trim())state.question=message.prompt.slice(0,6000);
      requestAssistantSources();closeArtifact();saveView();renderAssistant();composer?.focus();return;
    }
    if(message.type==="preparePlanBuild") {
      const pending=pendingPlanPreparation,descriptor=validatePlanDescriptor(message.planContext);
      if(!pending || !assistantSurface || !state.trusted || state.running || message.prepareId!==pending.prepareId || message.projectId!==state.project?.id || message.conversationId!==state.conversations?.activeId || pending.featureId!==(state.features?.activeId || null) || !descriptor || descriptor.requestId!==pending.requestId || descriptor.artifactId!==pending.artifactId || descriptor.revision!==pending.expectedRevision || descriptor.stepId!==pending.stepId || descriptor.conversationId!==message.conversationId)return;
      const turn=state.turns.find(item=>item.requestId===descriptor.requestId && item.plan?.id===descriptor.artifactId),revision=editablePlan(turn),original=turn?.plan?.steps.find(item=>item.id===descriptor.stepId),paths=[...new Set((original?.references || []).map(ref=>ref.path))];
      if(!turn || revision?.revision!==descriptor.revision || !revision.steps.some(step=>step.id===descriptor.stepId && step.included) || paths.length!==1 || message.file?.path!==paths[0] || typeof message.file.source!=="string" || typeof message.file.revision!=="string" || byteLength(message.file.source)>65536)return;
      pendingPlanPreparation=null;detachRequestRevision();markAssistantDraftEdited();state.intent="build";state.decisionContext=[];state.issueContext=[];state.planContext=descriptor;state.context=[message.file.path];state.contextInitialized=true;state.runtimeObservationIds=[];state.sidebarContextOpen=true;
      state.assistantContextFiles=[...state.assistantContextFiles.filter(file=>file.path!==message.file.path),message.file];
      if(!state.question.trim()){const step=revision.steps.find(step=>step.id===descriptor.stepId);state.question=`Implement this plan step: ${step.title}.\n${step.detail}`.slice(0,6000);}
      requestAssistantSources();closeArtifact();saveView();renderAssistant();return;
    }
    if(message.type==="planActionResult") {
      const pending=pendingPlanAction;
      if(!pending || message.action!==pending.action || message.projectId!==state.project?.id || message.conversationId!==state.conversations?.activeId || message.projectId!==pending.projectId || message.conversationId!==pending.conversationId || message.requestId!==pending.requestId || message.artifactId!==pending.artifactId || message.prepareId!==pending.prepareId)return;
      const turn=state.turns.find(item=>item.requestId===message.requestId && (item.plan?.id===message.artifactId || item.review?.id===message.artifactId));pendingPlanAction=null;if(message.action==="prepareBuild")pendingPlanPreparation=null;
      if(turn && message.passed!==true)planErrors.set(artifactKey(turn),typeof message.error==="string"?message.error.slice(0,1000):"The artifact action could not complete. Try again.");
      syncPlanDrafts();saveView();renderAssistant();return;
    }
    if(message.type==="visualVerificationComparison" || message.type==="visualVerificationScenario"){
      const pending=pendingVisualVerificationNavigation,action=message.type==="visualVerificationComparison"?"compare":"viewScenario";
      if(!pending || pending.action!==action || !state.trusted || ["projectId","featureId",...(action==="compare"?["id","beforeId","afterId"]:["screenId","scenarioId"])].some(key=>message[key]!==pending[key]))return;
      pending.ack=true;acknowledgeVisualVerificationNavigation();return;
    }
    if(message.type==="revealIssueEvidence") {
      const pending=pendingIssueEvidence,view=issueView(),item=view?.records.find(value=>value.record.id===message.issueId),run=state.runtimeWorkspace?.runs.find(value=>value.id===message.runId);
      if(!pending || !view || assistantSurface || ["projectId","issueId","runId"].some(key=>message[key]!==pending[key]) || message.projectId!==view.projectId || item?.record.run.id!==message.runId || !run || run.feature.id!==activeFeature()?.id)return;
      pendingIssueEvidence=null;knowledgeOpenProjectId=null;state.mode="Understand";pendingIssueReveal={projectId:state.project.id,featureId:run.feature.id,runId:run.id};saveView();render();requestAnimationFrame(()=>{const target=root.querySelector(`[data-lazy-disclosure="${CSS.escape("run/"+run.id)}"]`);target?.scrollIntoView({block:"start",behavior:"instant"});target?.querySelector("summary")?.focus({preventScroll:true});});return;
    }
    if(message.type==="revealAlternativeRecord") {
      const pending=pendingDecisionComparison,view=decisionView(),item=view?.records.find(item=>item.record.id===message.decisionId),alternatives=alternativeView();
      if(!pending || !view || assistantSurface || ["projectId","decisionId","comparisonId"].some(key=>message[key]!==pending[key]) || message.projectId!==view.projectId || item?.record.choice.comparisonId!==message.comparisonId || !alternatives?.records.some(record=>record.id===message.comparisonId))return;
      pendingDecisionComparison=null;state.mode="Review";const key="alternatives/"+view.projectId+"/record/"+message.comparisonId;pendingAlternativeReveal=key;saveView();render();requestAnimationFrame(()=>{const target=root.querySelector(`[data-lazy-disclosure="${CSS.escape(key)}"]`);target?.scrollIntoView({block:"nearest",behavior:"instant"});target?.querySelector("summary")?.focus({preventScroll:true});});return;
    }
    if(message.type==="visualAlternativesComparison"){receiveAlternativeComparison(message);return;}
    if(message.type==="visualAlternativesReview"){receiveAlternativeReview(message);return;}
    if(message.type==="visualAlternativesImage"){void receiveAlternativeImage(message);return;}
    if(message.type==="visualAlternativesPreview"){
      if(!state.trusted || message.projectId!==state.project?.id || assistantSurface)return;
      alternativePreviewHint=message;updateAlternativeCanvas();requestAlternativeWitness();return;
    }
    if(message.type==="runtimeCaptureImage"){void receiveRuntimeCaptureImage(message);return;}
    if (message.type === "state") {
      const priorProject = state.project?.id;
      const featureWasHydrated=assistantFeatureHydrated;
      const featureSelectionChanged = (message.features?.activeId || null) !== (state.features?.activeId || null);
      const nextDesign = message.design || null;
      const runtimeIdentityChanged = message.runtime?.session !== state.runtime?.session || message.runtime?.viewId !== state.runtime?.viewId;
      const runtimeStarted = Boolean(message.runtime?.session && runtimeIdentityChanged) ||
        ["starting", "connecting"].includes(message.runtime?.status) && message.runtime.status !== state.runtime?.status;
      if (runtimeIdentityChanged) state.runtimeObservationIds=[];
      if (nextDesign?.session && nextDesign.session === state.design?.session && nextDesign.html === undefined) nextDesign.html = state.design.html;
      if (nextDesign?.session !== state.design?.session) { state.designSelection = undefined; state.unmappedMessage = ""; state.skippedExperiments = 0; }
      Object.assign(state, {
        project: message.project || null,
        activeFile: message.activeFile || null,
        openFiles: Array.isArray(message.openFiles) ? message.openFiles : [],
        dirtyPaths: Array.isArray(message.dirtyPaths) ? message.dirtyPaths : [],
        changes: Array.isArray(message.changes) ? message.changes : [],
        selection: message.selection || null,
        focus: message.focus || null,
        trusted: message.trusted === true,
        provider: message.provider || null,
        assistantSurface: message.assistantSurface || null,
        connected: true,
        error: message.error || "",
        design: nextDesign,
        designImpact: message.trusted===true ? message.designImpact || null : null,
        visualVerification: message.trusted===true ? message.visualVerification || null : null,
        visualAlternatives: message.trusted===true ? message.visualAlternatives || null : null,
        aiAlternatives: message.trusted===true ? message.aiAlternatives || null : null,
        projectDecisions: message.trusted===true ? message.projectDecisions || null : null,
        reproducibleIssues: message.trusted===true ? message.reproducibleIssues || null : null,
        runtime: message.runtime || null,
        runtimeWorkspace: message.runtimeWorkspace || null,
        runtimeCaptures: message.trusted===true ? message.runtimeCaptures || null : null,
        runtimeReplays: message.trusted===true ? message.runtimeReplays || null : null,
        runtimeMatrices: message.trusted===true ? message.runtimeMatrices || null : null,
        runtimeStateSuites: message.trusted===true ? message.runtimeStateSuites || null : null,
        features: message.features || null,
        featureRelationships: message.featureRelationships || null,
        sourceInvestigation: message.trusted===true?message.sourceInvestigation || null:null,
        investigationContinuation:message.trusted===true?message.investigationContinuation || null:null,
        artifactSourceFiles: message.trusted===true && Array.isArray(message.artifactSourceFiles)?message.artifactSourceFiles:[],
        artifactSourceUnavailable: message.trusted===true && Array.isArray(message.artifactSourceUnavailable)?message.artifactSourceUnavailable:[],
        featureFiles: message.trusted===true && Array.isArray(message.featureFiles) ? message.featureFiles : [],
        featureLoading: message.featureLoading===true,
        assistantContextFiles: message.trusted===true && Array.isArray(message.assistantContextFiles) ? message.assistantContextFiles : [],
        featureCandidates: Array.isArray(message.featureCandidates) ? message.featureCandidates : [],
        featureUnavailable: Array.isArray(message.featureUnavailable) ? message.featureUnavailable : [],
        proposal: message.proposal || null,
        changeSetSession:message.trusted===true ? message.changeSetSession || null : null,
        executionSession:message.trusted===true ? message.executionSession || null : null,
      });
      reconcileVisualVerification();reconcileAlternatives();reconcileProjectDecisions();reconcileReproducibleIssues();
      if(pendingKnowledgeContext && (!state.trusted || pendingKnowledgeContext.projectId!==state.project?.id || !knowledgeItems().some(item=>item.id===pendingKnowledgeContext.id&&item.kind===pendingKnowledgeContext.kind&&item.digest===pendingKnowledgeContext.digest&&item.canShare))){pendingKnowledgeContext=null;knowledgeNotice="The selected record changed. Review it before adding context.";}
      if(pendingSuiteSave){const pending=pendingSuiteSave,session=suiteSession();if(!state.trusted || pending.projectId!==state.project?.id || session?.error || ["error","unavailable"].includes(session?.storage?.status))pendingSuiteSave=null;else if(session?.revision!==pending.revision && session?.storage?.status==="saved"){const saved=session.suites.find(item=>(pending.id?item.id===pending.id:!pending.existingIds.includes(item.id)) && item.featureId===matrixOwner()?.featureId && item.screenId===matrixOwner()?.screenId && item.scenarioId===matrixOwner()?.scenarioId && suiteValueDigest(suiteDefinitionDraft(item))===pending.digest);if(saved && suiteOwnerKey()===pending.ownerKey)setSuiteDraft(suiteDefinitionDraft(saved),false);pendingSuiteSave=null;}}
      const matrix=activeMatrix();if(matrix)lastMatrixId=matrix.id;
      if(pendingMatrixStart && (!state.trusted || pendingMatrixStart.projectId!==state.project?.id || state.runtimeMatrices?.revision!==pendingMatrixStart.revision || state.runtimeMatrices?.busy || state.runtimeMatrices?.error || ["error","unavailable"].includes(state.runtimeMatrices?.storage?.status)))pendingMatrixStart=null;
      if(pendingMatrixCancel && (!matrix || matrix.executionId!==pendingMatrixCancel || state.runtimeMatrices?.error))pendingMatrixCancel=null;
      if(!matrixPreview()){matrixPreviewHint=null;matrixPreviewAcknowledgment=null;}
      if(pendingReplayStart && (!state.trusted || pendingReplayStart.projectId!==state.project?.id || pendingReplayStart.runId!==recordingRun()?.id || state.runtimeReplays?.revision!==pendingReplayStart.revision || state.runtimeReplays?.busy || state.runtimeReplays?.error || ["error","unavailable"].includes(state.runtimeReplays?.storage?.status)))pendingReplayStart=null;
      if(pendingReplayCancel && (!state.trusted || !replaySession()?.replays.some(record=>record.executionId===pendingReplayCancel && record.status==="running") || state.runtimeReplays?.error))pendingReplayCancel=null;
      if(priorProject!==state.project?.id || featureSelectionChanged || !state.trusted){issueCaptureSelection=null;clearRuntimeCaptureImages();}
      else reconcileRuntimeCaptureImages();
      if (state.project && message.workspaceLayout && !hydratedLayouts.has(state.project.id)) {
        state.layouts[state.project.id] = {inspectorWidth:workspace.snapWidth(message.workspaceLayout.inspectorWidth)}; hydratedLayouts.add(state.project.id);
      }
      if (state.focus?.origin === "source" && state.designSelection?.path !== state.focus.path) state.designSelection = null;
      if (state.proposal?.requestId) {
        const owner = state.turns.find(turn => turn.requestId === state.proposal.requestId);
        if (owner) owner.proposal = state.proposal;
      }
      if (priorProject !== state.project?.id) {
        knowledgeState=window.FoundationKnowledge?.normalize(priorProject?null:persisted.knowledge,state.project?.id) || null;knowledgeCache=null;pendingKnowledgeContext=null;knowledgeNotice="";if(priorProject)knowledgeOpenProjectId=null;
        pendingSuiteSave=null;pendingMatrixStart=null;pendingMatrixCancel=null;matrixPreviewHint=null;matrixPreviewAcknowledgment=null;lastMatrixId=null;
        state.context = [];
        state.contextInitialized = Boolean(priorProject);
        assistantFeatureHydrated=false;clearAssistantSourceRestore();
        if(priorProject){pendingAssistantRestore=null;coldAssistantContextResolved=true;state.intent="ask";}
        closeArtifact();
        state.turns = [];
        state.conversations = null; state.historyOpen = false; state.historyAction = null; state.pendingRequestId = null;
        conversationDrafts.clear(); ephemeralTurns.clear();requestRevisionErrors.clear();groupRevisionErrors.clear();checkSuggestionErrors.clear();pendingCheckDecision=null;checkPlanSelectedIds.clear();
        if (priorProject || !assistantDraftEdited && persisted.questionProjectId !== state.project?.id) state.question = "";
        artifactCollapsed.clear();
        disclosureState.clear();
        state.running = false;
        state.designSelection = null;
        state.tokenDrafts = {};
        state.tokenInputs = {};
        state.selectedToken = null;
        state.designEntry = "";
        state.runtimeTargetId=""; state.runtimeUrlDraft=""; state.runtimeObservationIds=[];
        state.featureCreateOpen=false;pendingFeatureCreate=null;state.featureTaskIncluded=false;
        state.runtimeEditor=null;pendingRuntimeDefinition=null;
      }
      syncFeatureDrafts();syncRuntimeDefinitionDrafts();
      if(featureSelectionChanged && (featureWasHydrated || !assistantDraftEdited)) {state.context=[];state.contextInitialized=true;state.runtimeObservationIds=[];state.featureTaskIncluded=false;clearAssistantSourceRestore();state.runtimeEditor=null;pendingRuntimeDefinition=null;}
      if(state.features)assistantFeatureHydrated=true;
      if (!state.trusted) { state.conversations = null; state.turns = []; state.running = false; state.historyOpen = false; }
      else if (message.conversations) applyConversations(message.conversations);
      hydrateAssistantContext();
      if(pendingContinuation && (!matchingAssistantIdentity(pendingContinuation,assistantIdentity()) || pendingContinuation.featureRevision!==state.features?.revision || !artifacts.investigationChain(activeConversation(),state.turns.find(turn=>turn.requestId===pendingContinuation.requestId)?.investigationContext?.rootRequestId || pendingContinuation.requestId).canContinue)){clearContinuation();state.continuationNotice="The investigation checkpoint changed during preparation. Your draft is preserved.";}
      if(pendingContinuationAction && !matchingAssistantIdentity(pendingContinuationAction,assistantIdentity()))pendingContinuationAction=null;
      if(pendingSourceInvestigation && (!matchingAssistantIdentity(pendingSourceInvestigation,assistantIdentity()) || pendingSourceInvestigation.featureRevision!==state.features?.revision)){clearSourceInvestigation();state.investigationNotice="The investigation context changed during preparation. Your draft is preserved.";}
      if (state.pendingDesignContext && sourceFiles().some((file) => file.path === state.pendingDesignContext)) {
        state.context = [state.pendingDesignContext];
        state.contextInitialized = true;
        state.pendingDesignContext = null;
      }
      if (!state.contextInitialized && state.activeFile) {
        state.context = [state.activeFile.path];
        state.contextInitialized = true;
      }
      // Missing selections stay visible and block sending; loading must never
      // silently turn a chosen working set into a smaller request.
      if(!state.trusted){state.context=[];state.contextInitialized=true;state.featureTaskIncluded=false;clearAssistantSourceRestore();}
      if(pendingAcceptanceAction){const pending=pendingAcceptanceAction,session=state.changeSetSession;if(state.project?.id!==pending.projectId || session?.current?.id!==pending.groupId || session.current.revision!==pending.revision || session.error || ["error","unavailable"].includes(session.storage?.status) || pending.seenBusy && !session.busy)pendingAcceptanceAction=null;else if(session.busy)pending.seenBusy=true;}
      saveView();
      // Explicit host commands also start/connect projects. Switch once at the
      // transition; ordinary observations preserve a user's sandbox choice.
      if (!assistantSurface && state.trusted && state.project && runtimeStarted) {
        state.previewMode = "runtime"; saveView();
      }
      if(!acknowledgeVisualVerificationNavigation())render();
      return;
    }
    if(message.type==="assistantRestoreContextResult") {
      const request=assistantRestoreRequest;
      if(!request || message.requestId!==request.requestId || !matchingAssistantIdentity(request,assistantIdentity()) || !matchingAssistantIdentity(message,request))return;
      state.contextUnavailable=(Array.isArray(message.unavailable)?message.unavailable:[]).filter(item=>item && request.paths.includes(item.path) && state.context.includes(item.path) && typeof item.reason==="string").map(item=>({path:item.path,reason:item.reason.slice(0,1000)}));
      state.contextRestoreLoading=false;saveView();renderAssistant();return;
    }
    if(message.type==="runtimeMatrixPreview") {
      if(assistantSurface || !state.trusted || message.projectId!==state.project?.id)return;
      matrixPreviewHint=message;acknowledgeMatrixPreview();return;
    }
    if (message.type === "scenarioStarted" || message.type === "runtimeScreenOpened") {
      if(runtimeMatrixBusy())return;
      if(assistantSurface || !state.trusted || !state.project || !state.runtimeWorkspace)return;
      if(message.type==="scenarioStarted") {
        if(recordingRun()?.id!==message.runId)return;
        state.designInspect=false;
      }
      state.previewMode="runtime";state.mode="Refine";saveView();render();sendDesignSettings(true);return;
    }
    if (message.type === "prepareFeatureContext") {
      const feature=activeFeature();
      if(!assistantSurface || !state.trusted || state.running || !feature || message.projectId!==state.project?.id || message.featureId!==feature.id || message.revision!==state.features?.revision || featureDraftChanged(feature.id))return;
      const known=new Set(sourceFiles().map(file=>file.path));
      state.context=[...new Set(Array.isArray(message.paths)?message.paths:[])].filter(path=>known.has(path) && feature.paths.includes(path)).slice(0,8);
      state.contextInitialized=true;state.runtimeObservationIds=[];state.featureTaskIncluded=true;state.sidebarContextOpen=true;
      detachRequestRevision();markAssistantDraftEdited();if(assistantRestoreRequest)requestAssistantSources();
      saveView();renderAssistant();return;
    }
    if (message.type === "focusAssistant") {
      if (assistantSurface) composer?.focus();
      return;
    }
    if (message.type === "prepareAssistant") {
      if (!assistantSurface || !state.trusted || message.projectId !== state.project?.id || state.running) return;
      if (typeof message.contextPath === "string") {
        if (sourceFiles().some(file => file.path === message.contextPath)) {
          state.context = [message.contextPath]; state.contextInitialized = true;
        } else state.pendingDesignContext = message.contextPath;
      }
      detachRequestRevision();markAssistantDraftEdited();if(assistantRestoreRequest)requestAssistantSources();
      if (["ask","plan","build","review","change"].includes(message.intent)) state.intent = normalizeIntent(message.intent);
      if (typeof message.prompt === "string") state.question = message.prompt.slice(0, 6000);
      saveView(); renderAssistant(); composer?.focus(); return;
    }
    if (message.type === "mode") {
      if (assistantSurface) return;
      if (message.mode === "Build") action("foundation.build");
      else setMode(message.mode);
      return;
    }
    if (message.type === "error") {
      pendingAcceptanceAction=null;
      if (state.historyAction) { state.historyAction = null; state.historyFocus = true; }
      state.error =
        typeof message.message === "string"
          ? message.message
          : "The operation could not be completed.";
      render();
      return;
    }
    if (message.type === "status") {
      state.status = typeof message.message === "string" ? message.message : "";
      const footer = root.querySelector(".footer-note");
      if (footer) footer.textContent = state.status;
      return;
    }
    if (message.type === "ai") {
      const data = message.event;
      if (message.conversations) {
        const optimistic = state.turns.find(turn => turn.requestId === state.pendingRequestId);
        const terminal = ["error", "done", "cancelled"].includes(data?.type);
        if (!applyConversations(message.conversations, terminal ? message.requestId : undefined)) return;
        if (terminal && optimistic?.requestId === message.requestId && !state.turns.some(turn => turn.requestId === message.requestId)) {
          // Preflight/storage failure can happen before a durable turn exists.
          const failed = {...optimistic, state:"failed", error: data.error || "This request did not complete.", ephemeral:true};
          state.turns.push(failed); rememberEphemeral(failed);
          state.pendingRequestId = null; state.running = false;
        }
        renderAssistant();
        return;
      }
      if (message.conversationId && message.conversationId !== state.conversations?.activeId) return;
      const turn = state.turns.at(-1);
      if (!data || !artifacts.acceptsEvent(turn, message)) return;
      if (data.type === "start") { turn.model = data.model || turn.model; turn.started = true; if (Array.isArray(data.runtimeEvidence)) turn.runtimeEvidence=data.runtimeEvidence; }
      if (data.type === "cancelled") { turn.state = "stopped"; state.running = false; }
      if (data.type === "delta" && typeof data.text === "string")
        turn.answer += data.text;
      if(data.type==="alternatives" && data.alternatives && turn.alternativeGeneration)turn.alternatives=data.alternatives;
      if(data.type==="checkSuggestion" && data.checkSuggestion)turn.checkSuggestion=data.checkSuggestion;
      if(data.type==="changeSet" && data.changeSet)turn.changeSet=data.changeSet;
      if (data.type === "proposal" && data.proposal) {
        state.proposal = data.proposal;
        turn.proposal = data.proposal;
      }
      if (data.type === "done") {
        turn.completedWhileStopping = turn.state === "stopping";
        turn.state = "complete";
        turn.usage = data.usage;
        turn.model = data.model || turn.model;
        state.running = false;
      }
      if (data.type === "error") {
        turn.state = "failed";
        turn.error =
          data.error || "The provider could not complete this answer.";
        state.running = false;
      }
      if (data.type === "error" && state.conversations && !activeConversation()?.turns.some(item => item.requestId === turn.requestId)) {
        turn.ephemeral = true; rememberEphemeral(turn);
      }
      if (["done", "cancelled", "error"].includes(data.type)) state.pendingRequestId = null;
      renderAssistant();
      return;
    }
  });
  render();
  vscode.postMessage({ type: "ready", ...(historyReceiver ? { historyProtocol: 1 } : {}) });
})();
