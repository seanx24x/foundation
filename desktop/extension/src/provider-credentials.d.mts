export function resolveProviderKey(options: {
  baseUrl?: string;
  model?: string;
  environmentKey?: string;
  environmentOnly?: boolean;
  readStoredKey: () => PromiseLike<string | undefined>;
}): Promise<string | undefined>;
