import type { XcodeCatalog, XcodeDestination, XcodeOperation, XcodeRunner } from './xcode-project.mjs';
export type XcodeLanguageStatus = 'ready' | 'unavailable' | 'stale' | 'cancelled';
export interface XcodeLanguageTarget {
  id: string; name: string; projectName: string; moduleName: string;
  architecture: string; targetTriple: string; sdkPath: string;
  compilerPath: string; sourcekitPath: string; toolchainFingerprint: string;
  workingDirectory: string; sourcePaths: string[]; sourcePathAliases: {observed:string;canonical:string}[]; compilerArguments: string[];
}
export interface XcodeLanguagePreparation {
  status: XcodeLanguageStatus; root: string; projectPath: string; scheme: string;
  destination: XcodeDestination | null; build: XcodeOperation | null;
  sourceFingerprint: string | null; configurationFingerprint: string | null;
  targets: XcodeLanguageTarget[]; reason?: string;
}
export interface XcodeLanguageConfiguration {
  workspaceRoot: string; compilationDatabasePath: string; root: string;
  sourcePaths: string[]; target: XcodeLanguageTarget; destination: XcodeDestination;
  projectPath: string; scheme: string; sourceFingerprint: string;
  configurationFingerprint: string; settingsFingerprint: string; buildId: string;
}
export interface XcodeLanguageResult { status: XcodeLanguageStatus; reason?: string; }
export function readXcodeLanguageConfigurationFingerprint(root: string, options?: {signal?:AbortSignal}): Promise<string | null>;
export function prepareXcodeLanguageSettings(options: {root:string;trusted:boolean;catalog:XcodeCatalog;destinationId:string;signal?:AbortSignal;runner?:XcodeRunner}): Promise<XcodeLanguagePreparation>;
export function createXcodeCompilationDatabase(options: {preparation:XcodeLanguagePreparation;targetId:string;signal?:AbortSignal}): Promise<XcodeLanguageResult & {configuration?:XcodeLanguageConfiguration}>;
export function isXcodeLanguageConfiguration(configuration: unknown): configuration is XcodeLanguageConfiguration;
export function validateXcodeLanguageConfiguration(configuration: XcodeLanguageConfiguration, options?: {signal?:AbortSignal}): Promise<XcodeLanguageResult>;
export function disposeXcodeCompilationDatabase(configuration: XcodeLanguageConfiguration): Promise<void>;
