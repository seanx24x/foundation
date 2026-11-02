export function createAssistantBridge(assistant: {
  handle: (request: any) => unknown;
}): Promise<{ url: string; token: string; close: () => Promise<void> }>;
