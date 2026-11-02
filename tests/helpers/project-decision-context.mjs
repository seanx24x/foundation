import {createHash} from 'node:crypto';
import {normalizeProjectDecisionContext, projectDecisionDigest} from '../../server/project/project-decisions.mjs';

const id = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const hash = value => createHash('sha256').update(value).digest('hex');
const at = '2026-11-01T12:00:00.000Z';

/** Metadata-only local fixture: it is not evidence of a live model or app run. */
export function decisionFixture({projectId = 'fixture', path = 'src/Button.tsx', source = 'export const Button = () => <button>Save</button>;\n', index = 1} = {}) {
  const offset = index * 100;
  const feature = {id:id(1), title:'Save profile', revision:4, paths:[path]};
  const scope = {feature:structuredClone(feature), definitionRevision:2,
    screen:{id:id(2), featureId:feature.id, title:'Profile', targetId:'web', route:'/profile', archived:false, createdAt:at, updatedAt:at},
    scenario:{id:id(3), screenId:id(2), title:'Save profile', steps:['Press Save'], expectedOutcome:'The profile is saved.', archived:false, createdAt:at, updatedAt:at}};
  const evidence = ['baseline', 'alternative'].map((variant, i) => ({variant,
    run:{id:id(offset + 4 + i), digest:hash(`${index}-${variant}-run`), status:'completed', assessment:'not-assessed', observationCount:2, requestCount:1, unattributedRequestCount:1, truncated:false},
    replay:null, capture:null}));
  return {id:id(offset + 1), projectId, createdAt:at, title:'Keep clear save feedback',
    rationale:'Keep the selected save label because its action remains clear during refinement.', feature,
    choice:{kind:'token', comparisonId:id(offset + 2), candidateName:'Clear save', comparisonDigest:hash(`comparison-${index}`), baselineDigest:hash(`baseline-${index}`), sourceId:id(offset + 3),
      files:[{path, beforeHash:hash(`before-${source}`), afterHash:hash(source)}], scope,
      recipe:{id:'save-profile', title:'Save profile', route:'/profile', fixture:{id:'profile', label:'Profile fixture'}, catalogDigest:hash('catalog')},
      requested:{theme:'dark', motion:'reduce', viewportWidthCss:960, viewportHeightCss:680}, evidence,
      compilation:'not-recorded', assessment:'not-assessed', sourceRelationship:'unverified'},
    adoption:{kind:'token', id:id(offset + 6), appliedAt:at}, contextFiles:[{path, hash:hash(source)}]};
}

export function decisionContextFixture(options = {}) {
  const decision = decisionFixture(options);
  return normalizeProjectDecisionContext({version:1, projectId:decision.projectId, decisions:[{decision, digest:projectDecisionDigest(decision)}]}, {projectId:decision.projectId});
}
