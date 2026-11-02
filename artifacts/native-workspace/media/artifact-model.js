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
    const context = [{path:proposal.path, revision:proposal.baseRevision}, ...(proposal.context || []).filter(file => file.path !== proposal.path)];
    const evidence = freshness(context, files, dirtyPaths);
    const current = files.find(file => file.path === proposal.path);
    const dirty = dirtyPaths.includes(proposal.path) || context.some(file => dirtyPaths.includes(file.path));
    const superseded = currentId !== proposal.id;
    const stale = proposal.status === "stale" || (proposal.status === "proposed" && evidence.status === "stale");
    const conflict = Boolean(proposal.conflict) || (proposal.status === "applied" && current && current.revision !== proposal.appliedRevision);
    const reason = superseded ? "A newer proposal owns the review checkpoint. This saved response is read-only."
      : dirty ? "An editor draft is open. It remains unsaved and is not overwritten. Resolve it in the native editor before applying or undoing."
      : stale ? "Saved source changed. Prepare a new proposal before applying."
      : conflict ? "Source changed after Apply. Undo is blocked to preserve those edits."
      : proposal.reason || "";
    return {status:superseded ? "Previous proposal" : stale ? "Stale" : ({proposed:"Proposed",applied:"Applied",undone:"Undone",discarded:"Discarded"}[proposal.status] || "Unavailable"),
      evidence, dirty, stale, superseded, conflict, reason,
      canApply: proposal.status === "proposed" && !running && !dirty && !stale && !superseded && !proposal.reason,
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
  const api = Object.freeze({freshness, proposalState, verification, acceptsEvent});
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.FoundationArtifacts = api;
})();
