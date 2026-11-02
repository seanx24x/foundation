export type CodeSuggestionConfig = {providerKind?: string; baseUrl?: string; model?: string; apiKey?: string; timeoutMs?: number};
export type CodeSuggestionMetadata = {model: string; providerKind: string; usage?: {prompt_tokens?: number; completion_tokens?: number; total_tokens?: number}};
export type CodeSuggestionResult = ({kind: "completion"; text: string} | {kind: "edit"; oldText: string; newText: string; summary: string} | {kind: "none"}) & CodeSuggestionMetadata;
export class CodeSuggestionError extends Error {status: number; code: string; constructor(status: number, code: string, message: string);}
export function createCodeSuggestionService(options?: {config?: CodeSuggestionConfig}): {
  status(): {configured: boolean; provider?: string; providerKind?: string; capabilities?: {text: boolean; images: boolean; tools: boolean}; model?: string; transport?: string; reason?: string; limits: {contextBytes: number; completionBytes: number; editBytes: number; editLines: number; summaryChars: number; timeoutMs: number}};
  generate(input: {prefix: string; suffix: string; languageId: string; signal?: AbortSignal}): Promise<CodeSuggestionResult>;
};
