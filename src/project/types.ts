export type WorkspaceActivity = "Understand" | "Build" | "Refine" | "Review";
export interface ProjectEntry {
  path: string;
  size: number;
}
export interface ProjectSnapshot {
  id: string;
  name: string;
  root: string;
  files: ProjectEntry[];
  indexedAt: string;
  truncated: boolean;
  preview: { url: string; label: string } | null;
  targets: { name: string; command: string; framework: string }[];
}
export interface SourceSymbol {
  name: string;
  kind: string;
  line: number;
  endLine: number;
  exported: boolean;
}
export interface SourceImport {
  specifier: string;
  names: string[];
  line: number;
  resolvedPath: string | null;
}
export interface SourceConsumer {
  path: string;
  line: number;
  specifier: string;
}
export interface SourceRequest {
  method: string;
  url: string;
  line: number;
}
export interface FileAnalysis {
  symbols: SourceSymbol[];
  imports: SourceImport[];
  consumers: SourceConsumer[];
  requests: SourceRequest[];
  unsupported: boolean;
}
export interface ProjectFile {
  path: string;
  source: string;
  revision: string;
  language: string;
  analysis: FileAnalysis;
}
export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  text: string;
}
export interface SearchResults {
  matches: SearchMatch[];
  truncated: boolean;
}
export interface ProjectChange {
  path: string;
  before: string;
  after: string;
  baseRevision: string;
  revision: string;
  conflict: boolean;
}
export interface ProjectChanges {
  changes: ProjectChange[];
}
export interface AssistantContext {
  path: string;
  revision: string;
}
