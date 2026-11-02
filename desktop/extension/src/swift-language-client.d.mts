export type SwiftLanguageState = 'idle' | 'connecting' | 'connected' | 'stopping' | 'stopped' | 'failed';
export interface SwiftLanguageSnapshot {
  state: SwiftLanguageState; contextVersion: number; pid: number | null; sessionId: string | null;
  documents: Array<{ uri: string; version: number }>; pendingRequests: number;
  requestCount: number; completedRequests: number; cancelledRequests: number; droppedDiagnostics: number; lastError: string | null;
}
export interface SwiftLanguageDiagnosticEvent {
  uri: string; version: number; contextVersion: number; diagnostics: unknown[]; source: 'pull' | 'push'; sessionId: string;
}
export interface SwiftLanguageCallbacks {
  onDiagnostics?(event: SwiftLanguageDiagnosticEvent): void;
  onState?(snapshot: SwiftLanguageSnapshot): void;
  onError?(error: Error & { code?: string }): void;
  onExit?(event: { code: number | null; signal: string | null; expected: boolean; sessionId: string }): void;
  onDiagnosticRefresh?(): void;
}
export interface SwiftLanguageConfiguration {
  /** A private compile_commands.json workspace produced by validated Xcode settings. */
  workspaceRoot: string; projectRoot: string; compilationDatabasePath: string; sourcePaths: string[];
  /** Absolute SourceKit-LSP path from the same toolchain as the selected compiler. */
  executable: string; signal?: AbortSignal;
}
export interface SwiftLanguageDocument { uri: string; text: string; version: number }
export interface SwiftLanguageRequestOptions { signal?: AbortSignal; timeoutMs?: number }
export interface SwiftLanguageClient {
  connect(configuration: SwiftLanguageConfiguration): Promise<unknown>;
  openDocument(document: SwiftLanguageDocument): void;
  changeDocument(document: SwiftLanguageDocument): void;
  closeDocument(uri: string): void;
  /** Retire all pending document results after a saved target dependency changes outside an open buffer. */
  invalidateContext(changedUri?: string): void;
  /** Returns raw LSP results; only the five read-only document methods are accepted. Edits/close cancel pending results. */
  request(method: 'textDocument/completion' | 'textDocument/definition' | 'textDocument/hover' | 'textDocument/documentSymbol' | 'textDocument/diagnostic', params: Record<string, unknown>, options?: SwiftLanguageRequestOptions): Promise<any>;
  stop(): Promise<void>;
  snapshot(): SwiftLanguageSnapshot;
}
export function createSwiftLanguageClient(callbacks?: SwiftLanguageCallbacks, dependencies?: {
  spawnProcess?: (...args: any[]) => any; killProcessGroup?: (pid: number, signal: string) => void;
  shutdownTimeoutMs?: number; exitTimeoutMs?: number; terminateTimeoutMs?: number;
}): SwiftLanguageClient;
export function encodeLspMessage(message: unknown, maximum?: number): Buffer;
export class LspFrameDecoder { constructor(options?: { maximum?: number }); push(chunk: Buffer | Uint8Array | string): any[] }
