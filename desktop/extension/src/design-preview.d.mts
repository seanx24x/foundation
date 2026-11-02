export interface PreviewSource { path: string; source: string; revision: string; }
export interface DesignPreview {
  html: string;
  revision: string;
  entry: string;
  mappings: string[];
  files: { path: string; revision: string }[];
  capabilities: { network: false; sourceMapping: 'explicit' };
}
export function buildDesignPreview(options: {
  files: PreviewSource[];
  entry?: string;
  nonce: string;
  runtimeSource: string;
  session: string;
}): DesignPreview;
