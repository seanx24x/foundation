import type { ProjectEntry, ProjectFile } from '../../../src/project/types.js';

export interface Feature {
  id: string;
  title: string;
  brief: string;
  paths: string[];
  entryPath?: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface FeatureSnapshot {
  schemaVersion: 1;
  projectId: string;
  revision: number;
  activeId: string | null;
  features: Feature[];
  storage: { status: 'saved' | 'saving' | 'error' | 'unavailable'; message?: string };
}
export interface CreateFeatureInput { title: string; brief?: string; paths?: string[]; entryPath?: string }
export interface UpdateFeatureInput { title?: string; brief?: string; paths?: string[]; entryPath?: string | null }
export interface FeatureStore {
  snapshot(): FeatureSnapshot;
  create(input: CreateFeatureInput, expectedRevision: number): Promise<FeatureSnapshot>;
  update(id: string, patch: UpdateFeatureInput, expectedRevision: number): Promise<FeatureSnapshot>;
  select(id: string | null, expectedRevision: number): Promise<FeatureSnapshot>;
  archive(id: string, archived: boolean, expectedRevision: number): Promise<FeatureSnapshot>;
  retry(): Promise<FeatureSnapshot>;
  dispose(): Promise<void>;
}
export function createFeatureStore(options: {
  projectId: string;
  read: () => unknown;
  write: (snapshot: Omit<FeatureSnapshot, 'storage'>) => PromiseLike<unknown> | unknown;
  onChange?: () => void;
}): FeatureStore;
export interface FeatureFileSuggestion {
  path: string;
  reason: 'import' | 'consumer' | 'test-name';
  provenance: 'source' | 'filename';
  line?: number;
}
export function suggestFeatureFiles(input: {
  anchorFile: ProjectFile | null;
  inventory: ProjectEntry[];
  existingPaths?: string[];
}): FeatureFileSuggestion[];
