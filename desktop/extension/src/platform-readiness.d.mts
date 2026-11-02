import type { ChildProcess } from 'node:child_process';
export type PlatformKind = 'web' | 'swift' | 'swiftui' | 'xcode' | 'expo' | 'react-native';
export type PlatformCheckStatus = 'available' | 'missing' | 'unavailable' | 'unknown' | 'failed';
export interface PlatformReadinessCheck { id: string; platform: 'host' | 'project' | 'web' | 'apple' | 'expo'; label: string; status: PlatformCheckStatus; detail: string; recovery?: string; version?: string; }
export interface PlatformReadinessReport {
  schemaVersion: 1;
  root: string;
  checkedAt: string;
  inputFingerprint: string | null;
  status: 'complete' | 'cancelled' | 'unavailable' | 'stale';
  project: { name: string; kinds: PlatformKind[]; markers: { path: string; kind: string }[]; limitations: string[] };
  checks: PlatformReadinessCheck[];
  capabilities: { id: string; label: string; status: 'unverified' | 'unavailable'; detail: string }[];
  reason?: string;
}
export type PlatformProbeId = 'xcode-select' | 'xcode-version' | 'simulators';
export interface PlatformProbeResult { status: 'passed' | 'failed' | 'cancelled' | 'timeout' | 'output-limit' | 'unavailable'; reason?: string; code?: number | null; signal?: string | null; stdout?: string; stderr?: string; }
export function isPlatformReadinessInput(path: string): boolean;
export function readPlatformInputFingerprint(root: string, options?: { signal?: AbortSignal }): Promise<string | null>;
export function runPlatformProbe(id: PlatformProbeId, options?: { signal?: AbortSignal; timeoutMs?: number; spawnProcess?: (...args: any[]) => ChildProcess }): Promise<PlatformProbeResult>;
export function inspectPlatformReadiness(options: { root: string; trusted: boolean; signal?: AbortSignal; platform?: NodeJS.Platform; probe?: (id: PlatformProbeId, options: { signal?: AbortSignal }) => Promise<PlatformProbeResult> }): Promise<PlatformReadinessReport>;
