export type InlineEditConfig = {providerKind?: string; baseUrl?: string; model?: string; apiKey?: string; timeoutMs?: number};
export type InlineEditResult = {replacement: string; summary: string; model: string; providerKind: string; usage?: {prompt_tokens?: number; completion_tokens?: number; total_tokens?: number}};
export class InlineEditError extends Error {status: number; code: string; constructor(status: number, code: string, message: string);}
export function createInlineEditService(options?: {config?: InlineEditConfig}): {
  status(): {configured: boolean; provider?: string; providerKind?: string; capabilities?: {text: boolean; images: boolean; tools: boolean}; model?: string; transport?: string; reason?: string; limits: {selectionBytes: number; replacementBytes: number; promptChars: number; summaryChars: number}};
  generate(input: {selection: string; languageId: string; prompt: string; signal?: AbortSignal}): Promise<InlineEditResult>;
};
