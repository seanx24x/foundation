export interface CaptureRuntimeIdentity {targetId:string;session:string;viewId:string;documentId:string;route:string;pageVersion:number}
export interface CaptureSource {path:string;revision:string}
export interface CaptureBinding {startedAt:string;definitionRevision:number;runtime:CaptureRuntimeIdentity;sources:CaptureSource[];dirtyPaths:string[]}
export interface CaptureContext extends CaptureBinding {projectId:string;runId:string;featureId:string;screenId:string;scenarioId:string}
export interface CaptureConditions {
  viewportWidthCss:number;viewportHeightCss:number;deviceScaleFactor:number;scrollXCss:number;scrollYCss:number;canvasScale:number;
  colorSchemePreference:'light'|'dark'|'no-preference'|'unknown';reducedMotionPreference:'reduce'|'no-preference'|'unknown';
  appTheme:'unknown';dataState:'unknown';animationState:'unknown';
}
export interface CaptureImage {assetId:string;sha256:string;byteLength:number;widthPx:number;heightPx:number;mimeType:'image/png'}
export interface RuntimeCapture {id:string;runId:string;featureId:string;screenId:string;scenarioId:string;capturedAt:string;binding:CaptureBinding;image:CaptureImage;conditions:CaptureConditions;sourceRelationship:'unverified'}
export interface RuntimeCaptureManifest {schemaVersion:1;projectId:string;revision:number;captures:RuntimeCapture[]}
export interface RuntimeCaptureSnapshot extends RuntimeCaptureManifest {storage:{status:'saved'|'saving'|'error'|'unavailable';message?:string}}
export interface RuntimeCaptureStore {
  snapshot():RuntimeCaptureSnapshot;
  /** Constant-time ownership state without copying capture metadata or reading pixels. */
  state():{revision:number;storageStatus:RuntimeCaptureSnapshot['storage']['status']};
  /** Read-only committed-metadata refresh; rejects while saving or if history changed unsafely. */
  reconcile():RuntimeCaptureSnapshot;
  saveCapture(input:{context:CaptureContext;conditions:CaptureConditions;png:Uint8Array;capturedAt:string}):Promise<RuntimeCapture>;
  readCapture(id:string):Promise<{capture:RuntimeCapture;png:Buffer}>;
}
export interface CaptureStorageAdapters {
  read():unknown;
  write(manifest:RuntimeCaptureManifest):PromiseLike<unknown>|unknown;
  /** Atomic create-only; enforce actual disk quota including orphan assets. */
  writeAsset(assetId:string,png:Uint8Array):PromiseLike<unknown>|unknown;
  readAsset(assetId:string):PromiseLike<Uint8Array>|Uint8Array;
}
export const CAPTURE_LIMITS:Readonly<{captures:40;imageBytes:number;imagePixels:16000000;imageDimension:8192;projectBytes:number;sources:32}>;
export function inspectCapturePng(input:Uint8Array):Omit<CaptureImage,'assetId'>;
export function createRuntimeCaptureStore(options:CaptureStorageAdapters & {projectId:string}):RuntimeCaptureStore;
