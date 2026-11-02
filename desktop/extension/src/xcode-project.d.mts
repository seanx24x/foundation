import type { ChildProcess } from 'node:child_process';
export type XcodeCatalogStatus = 'complete' | 'unavailable' | 'cancelled' | 'stale';
export type XcodeProcessStatus = 'passed' | 'failed' | 'cancelled' | 'timeout' | 'output-limit' | 'unavailable';
export interface XcodeProject { path: string; name: string; kind: 'project' | 'workspace'; }
export interface XcodeDestination { id: string; label: string; platform: 'iOS Simulator'; kind: 'simulator' | 'generic'; testEligible: boolean; }
export interface XcodeDiscovery {
  schemaVersion: 1; root: string; checkedAt: string; status: XcodeCatalogStatus;
  inputFingerprint: string | null; endFingerprint?: string | null;
  projects: XcodeProject[]; limitations: string[]; reason?: string;
}
export interface XcodeCatalog extends XcodeDiscovery {
  projectPath: string; schemes: string[]; selectedScheme?: string; destinations: XcodeDestination[];
  diagnostic?: XcodeProcessResult;
  languageTooling: { status: 'available' | 'unavailable' | 'failed'; detail: string; version?: string };
}
export interface XcodeProcessRequest {
  tool: 'xcodebuild' | 'sourcekit-lsp'; args: string[]; cwd: string;
  timeoutMs: number; maxOutputBytes: number;
}
export interface XcodeProcessResult {
  status: XcodeProcessStatus; stdout: string; stderr: string; exitCode: number | null;
  reason?: string;
}
export type XcodeRunner = (request: XcodeProcessRequest, options: { signal?: AbortSignal }) => Promise<XcodeProcessResult>;
export interface XcodeOperation {
  schemaVersion: 1; id: string; root: string; projectPath: string; scheme: string;
  destination: XcodeDestination | null; action: 'build' | 'test';
  status: XcodeProcessStatus | 'stale'; startedAt: string; finishedAt: string;
  inputFingerprint: string | null; endFingerprint: string | null; sourceCurrent: boolean;
  stdout: string; stderr: string; exitCode: number | null; reason?: string; recovery?: string;
  artifacts: { directory: string; derivedData: string; resultBundle: string } | null;
}
export function isXcodeSourceInput(relativePath: string): boolean;
export function readXcodeSourceFingerprint(root: string, options?: { signal?: AbortSignal }): Promise<string | null>;
export function discoverXcodeProjects(options: { root: string; trusted: boolean; signal?: AbortSignal }): Promise<XcodeDiscovery>;
export function inspectXcodeProject(options: { root: string; trusted: boolean; projectPath: string; scheme?: string; signal?: AbortSignal; runner?: XcodeRunner }): Promise<XcodeCatalog>;
export function runXcodeOperation(options: { root: string; trusted: boolean; catalog: XcodeCatalog; destinationId: string; action: 'build' | 'test'; signal?: AbortSignal; runner?: XcodeRunner; timeoutMs?: number }): Promise<XcodeOperation>;
export function runXcodeProcess(request: XcodeProcessRequest, options?: { signal?: AbortSignal; spawnProcess?: (...args: any[]) => ChildProcess }): Promise<XcodeProcessResult>;
