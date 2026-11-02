import type {CaptureStorageAdapters,RuntimeCaptureManifest} from './runtime-capture-store.mjs';
export interface CaptureFileStorage extends CaptureStorageAdapters {
  /** Read-only quota headroom including orphan assets and abandoned temporary files; not a disk-space reservation. */
  availableBytes():number;
  read():unknown;
  write(manifest:RuntimeCaptureManifest):Promise<void>;
  writeAsset(assetId:string,png:Uint8Array):Promise<void>;
  readAsset(assetId:string):Promise<Buffer>;
  /** Only this project's immutable asset directory may become a webview resource root. */
  readonly assetRoot:string;
  /** Checks identity and a private, regular file. Verify through store.readCapture before exposing a URI. */
  assetPath(assetId:string):string;
}
/** Initializes private scoped directories synchronously. root is host storage, never repository source. */
export function createCaptureFileStorage(options:{root:string;projectId:string}):CaptureFileStorage;
