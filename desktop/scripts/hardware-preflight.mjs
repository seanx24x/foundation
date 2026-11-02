import { execFile } from 'node:child_process';
import os from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);
const commandOptions = Object.freeze({ encoding: 'utf8', timeout: 3000, maxBuffer: 16 * 1024, killSignal: 'SIGKILL', windowsHide: true });
const commands = Object.freeze({
  model: Object.freeze({ executable: '/usr/sbin/sysctl', args: Object.freeze(['-n', 'hw.model']) }),
  power: Object.freeze({ executable: '/usr/bin/pmset', args: Object.freeze(['-g', 'batt']) }),
});
const boundedText = value => typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= commandOptions.maxBuffer && !value.includes('\0');
const label = value => typeof value === 'string' && value.trim() && value.length <= 160 && !/[\r\n\0]/.test(value) ? value.trim() : 'unknown';
const positiveInteger = value => Number.isSafeInteger(value) && value > 0 ? value : null;

export function parseHardwareModel(output) {
  if (!boundedText(output)) return null;
  const model = output.trim();
  return /^[A-Za-z][A-Za-z0-9]{0,31}\d+,\d+$/.test(model) ? model : null;
}

export function parseBatteryStatus(output) {
  const result = { internalBattery: 'unknown', source: 'unknown', batteryPercent: null, chargingState: 'unknown' };
  if (!boundedText(output)) return result;
  const lines = output.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const headers = lines.filter(line => /^Now drawing from '/.test(line));
  const header = headers.length === 1 ? /^Now drawing from '(AC Power|Battery Power|UPS Power)'$/.exec(headers[0]) : null;
  if (header && header[1] !== 'UPS Power') result.source = header[1];
  const batteries = lines.filter(line => /^-InternalBattery-\d+\b/.test(line));
  if (!batteries.length) {
    // A successful, recognized header alone is the desktop/no-battery shape.
    // Other text is not evidence that a battery is absent.
    if (header && lines.length === 1) result.internalBattery = 'absent';
    return result;
  }
  if (batteries.length !== 1) return result;
  const record = /^-InternalBattery-\d+(?:\s+\(id=[^()\r\n]+\))?\s+(.+)$/.exec(batteries[0]);
  if (!record) return result;
  const fields = record[1].split(';').map(field => field.trim());
  const presenceFields = [...record[1].matchAll(/\bpresent:\s*(true|false)\b/g)];
  if (presenceFields.length > 1) return result;
  const presence = presenceFields[0];
  const percentage = /^(\d{1,3})%$/.exec(fields[0]);
  const percentageValue = percentage ? Number(percentage[1]) : null;
  const states = fields.map(field => field.replace(/\s+present:\s*(?:true|false)$/, '')).filter(field => ['charging', 'discharging', 'charged', 'not charging', 'finishing charge'].includes(field));
  // Older pmset versions can omit the present field; require their complete
  // percentage/state shape before treating the named battery as present.
  if (presence) result.internalBattery = presence[1] === 'true' ? 'present' : 'absent';
  else if (percentageValue !== null && percentageValue <= 100 && states.length === 1) result.internalBattery = 'present';
  if (result.internalBattery !== 'present') return result;
  if (percentageValue !== null && percentageValue <= 100) result.batteryPercent = percentageValue;
  if (states.length === 1) result.chargingState = states[0].replaceAll(' ', '-');
  return result;
}

function readSystem() {
  const cpus = os.cpus();
  return { platform: process.platform, architecture: process.arch, osRelease: os.release(), cpu: cpus[0]?.model, logicalCores: cpus.length, memoryBytes: os.totalmem() };
}

async function sampleCommand(name, runCommand) {
  const { executable, args } = commands[name];
  try {
    const result = await runCommand(executable, [...args], { ...commandOptions });
    if (!boundedText(result?.stdout)) return { status: 'unavailable', reason: 'invalid-output' };
    return { status: 'completed', output: result.stdout };
  } catch (error) {
    // Do not emit raw stdout/stderr, command messages, paths, or device IDs.
    const reason = error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'output-limit' : error?.killed || error?.code === 'ETIMEDOUT' ? 'timeout' : 'command-failed';
    return { status: 'unavailable', reason };
  }
}

function laptopEligibility(hardware, power) {
  if (hardware.platform === 'unknown' || hardware.architecture === 'unknown') return { status: 'unknown', reason: 'Platform or architecture could not be identified.' };
  if (hardware.platform !== 'darwin' || hardware.architecture !== 'arm64') return { status: 'ineligible', reason: 'This laptop acceptance profile requires macOS on arm64.' };
  if (power.internalBattery === 'unknown') return { status: 'unknown', reason: 'An internal battery could not be confirmed.' };
  if (power.internalBattery === 'absent') return { status: 'ineligible', reason: 'No internal battery was reported.' };
  return { status: 'eligible', reason: 'macOS arm64 with a reported internal battery; eligible to begin a separate laptop run.' };
}

export async function collectHardwarePreflight({ system = readSystem(), runCommand = executeFile, now = () => new Date() } = {}) {
  const sampledAt = new Date(now()).toISOString();
  const hardware = {
    platform: label(system.platform), architecture: label(system.architecture), osRelease: label(system.osRelease), cpu: label(system.cpu),
    logicalCores: positiveInteger(system.logicalCores), memoryBytes: positiveInteger(system.memoryBytes), model: null,
  };
  let power = parseBatteryStatus(null);
  const evidence = { model: { status: 'not-run', reason: 'unsupported-platform' }, power: { status: 'not-run', reason: 'unsupported-platform' } };
  if (hardware.platform === 'darwin') {
    const [modelSample, powerSample] = await Promise.all([sampleCommand('model', runCommand), sampleCommand('power', runCommand)]);
    if (modelSample.status === 'completed') hardware.model = parseHardwareModel(modelSample.output);
    if (powerSample.status === 'completed') power = parseBatteryStatus(powerSample.output);
    evidence.model = modelSample.status === 'completed' ? { status: hardware.model ? 'available' : 'unknown' } : modelSample;
    evidence.power = powerSample.status === 'completed' ? { status: power.internalBattery === 'unknown' ? 'unknown' : 'available' } : powerSample;
  }
  return {
    schemaVersion: 1, status: 'preflight-only', sampledAt, hardware, power, eligibility: laptopEligibility(hardware, power), evidence,
    acceptance: { laptopRun: 'not-run', physicalLatency: 'not-run', display: 'unknown', refreshRate: 'unknown', keyboard: 'unknown', camera: 'unknown', powerContinuity: 'unknown' },
    limitations: [
      'This is one read-only hardware and power sample, not a benchmark or acceptance result.',
      'Eligibility uses macOS arm64 and internal-battery evidence. A model name alone does not establish portable hardware.',
      'Battery percentage, power source and charging state may change after this sample; power continuity has not been measured.',
    ],
  };
}

export async function runHardwarePreflightCLI(args, { collect = collectHardwarePreflight, stdout = value => process.stdout.write(value), stderr = value => process.stderr.write(value) } = {}) {
  if (args.length > 1 || args.length === 1 && args[0] !== '--require-laptop') {
    stderr('Usage: node desktop/scripts/hardware-preflight.mjs [--require-laptop]\n');
    return 1;
  }
  try {
    const report = await collect();
    stdout(`${JSON.stringify(report, null, 2)}\n`);
    return args.includes('--require-laptop') && report.eligibility?.status !== 'eligible' ? 2 : 0;
  } catch {
    stderr('Hardware preflight could not be collected. No acceptance result was recorded.\n');
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runHardwarePreflightCLI(process.argv.slice(2));
}
