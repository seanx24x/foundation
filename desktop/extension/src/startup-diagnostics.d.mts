export type DiagnosticPhase =
  | 'project-open' | 'project-snapshot' | 'selected-source-read'
  | 'preview-source-read' | 'preview-runtime-read' | 'preview-compilation';
export function createStartupDiagnostics(
  appendLine: (line: string) => void,
  options?: { timestamp?: () => string; clock?: () => number },
): {
  runSync<T>(phase: DiagnosticPhase, work: () => T): T;
  runAsync<T>(phase: DiagnosticPhase, work: () => T | PromiseLike<T>): Promise<T>;
};
