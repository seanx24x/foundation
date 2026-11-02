export type EvidenceKind = 'From source' | 'Observed' | 'AI interpretation' | 'Unknown';

export interface SourceReference {
  path: string;
  revision: string;
  startLine: number;
  endLine?: number;
}

export interface Evidence<T = unknown> {
  id: string;
  kind: EvidenceKind;
  value: T;
  revision: string;
  runtimeSession?: string;
  source?: SourceReference;
  timestamp: string;
}

export interface ProjectEntity {
  id: string;
  name: string;
  kind: 'component' | 'function' | 'endpoint' | 'state' | 'test';
  source?: SourceReference;
  evidence: Evidence[];
}

export type CapabilityStatus = 'available' | 'requires-instrumentation' | 'unsupported';

export interface AdapterCapabilities {
  platform: 'web' | 'swiftui' | 'react-native';
  sourceMapping: CapabilityStatus;
  runtimeInspection: CapabilityStatus;
  requestCapture: CapabilityStatus;
  visualEditing: CapabilityStatus;
}

export interface RequestEvidence {
  id: string;
  method: 'POST';
  path: '/api/profile';
  status: number;
  durationMs: number;
  timestamp: string;
  revision: string;
  response: { ok: boolean; message?: string; error?: string; updatedAt?: string };
}

export interface ChangeProposal {
  id: string;
  title: string;
  summary: string;
  before: string;
  after: string;
  baseRevision: string;
  status: 'proposed' | 'applied';
}

export interface VerificationCheck {
  name: 'TypeScript' | 'Interaction' | 'Visual';
  status: 'passed' | 'failed' | 'not-run';
  detail: string;
}

export interface VerificationRun {
  revision: string;
  checks: VerificationCheck[];
  timestamp: string;
}

export interface WorkspaceSnapshot {
  project: 'Orbit';
  revision: string;
  source: string;
  sourcePath: 'fixtures/web/src/SaveButton.tsx';
  changed: boolean;
  mappingSupported: boolean;
  undoAvailable: boolean;
  proposal: ChangeProposal | null;
  requests: RequestEvidence[];
  verification: VerificationRun | null;
}

export interface SourceUpdate {
  source: string;
  baseRevision: string;
}

export interface ApiError {
  error: string;
  code: string;
  revision?: string;
}
