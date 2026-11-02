import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseHardwareModel, parseBatteryStatus, collectHardwarePreflight, runHardwarePreflightCLI } from '../scripts/hardware-preflight.mjs';

const system = { platform: 'darwin', architecture: 'arm64', osRelease: '25.0.0', cpu: 'Apple fixture CPU', logicalCores: 12, memoryBytes: 32 * 1024 ** 3 };
const now = () => '2026-10-31T12:00:00.000Z';
const battery = (source, value = '76%; charging; (no estimate) present: true') => `Now drawing from '${source}'\n -InternalBattery-0 (id=1234567) ${value}\n`;
const collect = (power, overrides = {}) => collectHardwarePreflight({ system, now, runCommand: async executable => ({ stdout: executable.endsWith('sysctl') ? 'Mac14,2\n' : power }), ...overrides });

test('model parsing accepts only the fixed sysctl model format, never arbitrary output', () => {
  assert.equal(parseHardwareModel('Mac15,14\n'), 'Mac15,14');
  assert.equal(parseHardwareModel('MacBookPro18,3\n'), 'MacBookPro18,3');
  for (const value of [undefined, '', 'hw.model: Mac15,14', 'Mac15,14\nprivate device value', '\0Mac15,14', 'x'.repeat(16385)]) assert.equal(parseHardwareModel(value), null);
});

test('recognized desktop output is absent battery evidence; empty and malformed output stay unknown', () => {
  assert.deepEqual(parseBatteryStatus("Now drawing from 'AC Power'\n"), { internalBattery: 'absent', source: 'AC Power', batteryPercent: null, chargingState: 'unknown' });
  for (const output of [undefined, '', 'InternalBattery unavailable', "Now drawing from 'new unknown source'", "Now drawing from 'AC Power'\nunrecognized diagnostic", 'x'.repeat(16385)]) assert.equal(parseBatteryStatus(output).internalBattery, 'unknown');
});

test('battery parsing distinguishes charging, discharging, charged and not-charging conservatively', () => {
  const cases = [
    ['AC Power', '76%; charging; (no estimate) present: true', 76, 'charging'],
    ['Battery Power', '49%; discharging; 3:20 remaining present: true', 49, 'discharging'],
    ['AC Power', '100%; charged; 0:00 remaining present: true', 100, 'charged'],
    ['AC Power', '80%; AC attached; not charging present: true', 80, 'not-charging'],
    ['AC Power', '80%; not charging; 0:00 remaining present: true', 80, 'not-charging'],
    ['AC Power', '99%; finishing charge; 0:00 remaining present: true', 99, 'finishing-charge'],
  ];
  for (const [source, value, percent, chargingState] of cases) assert.deepEqual(parseBatteryStatus(battery(source, value)), { internalBattery: 'present', source, batteryPercent: percent, chargingState });
  assert.equal(parseBatteryStatus(battery('AC Power', '45%; charging; (no estimate)')).internalBattery, 'present', 'Older valid output without present is supported');
});

test('ambiguous or unavailable battery fields are never filled with inferred values', () => {
  const absent = parseBatteryStatus(battery('AC Power', '0%; charged; 0:00 remaining present: false'));
  assert.equal(absent.internalBattery, 'absent'); assert.equal(absent.batteryPercent, null); assert.equal(absent.chargingState, 'unknown');
  const invalid = parseBatteryStatus(battery('AC Power', '150%; unrecognized state; present: true'));
  assert.equal(invalid.internalBattery, 'present'); assert.equal(invalid.batteryPercent, null); assert.equal(invalid.chargingState, 'unknown');
  const ambiguous = parseBatteryStatus(battery('AC Power') + '-InternalBattery-1 23%; discharging; present: true\n');
  assert.equal(ambiguous.internalBattery, 'unknown'); assert.equal(ambiguous.batteryPercent, null);
  assert.equal(parseBatteryStatus('-InternalBattery-0 nonsense').internalBattery, 'unknown');
  assert.equal(parseBatteryStatus(battery('AC Power', '40%; charging; present: true present: false')).internalBattery, 'unknown');
});

test('collector uses only fixed, bounded commands and emits no raw device IDs or output', async () => {
  const calls = [];
  const report = await collectHardwarePreflight({ system, now, runCommand: async (executable, args, options) => {
    calls.push({ executable, args, options });
    return { stdout: executable.endsWith('sysctl') ? 'Mac14,2\n' : battery('AC Power'), stderr: 'private stderr marker' };
  } });
  assert.deepEqual(calls.map(({ executable, args }) => ({ executable, args })), [
    { executable: '/usr/sbin/sysctl', args: ['-n', 'hw.model'] }, { executable: '/usr/bin/pmset', args: ['-g', 'batt'] },
  ]);
  for (const { options } of calls) { assert.equal(options.timeout, 3000); assert.equal(options.maxBuffer, 16384); assert.equal(options.killSignal, 'SIGKILL'); assert.equal(options.shell, undefined); }
  assert.equal(report.status, 'preflight-only'); assert.equal(report.sampledAt, now()); assert.equal(report.eligibility.status, 'eligible');
  assert.deepEqual(report.hardware, { ...system, model: 'Mac14,2' });
  assert.deepEqual(report.acceptance, { laptopRun: 'not-run', physicalLatency: 'not-run', display: 'unknown', refreshRate: 'unknown', keyboard: 'unknown', camera: 'unknown', powerContinuity: 'unknown' });
  assert.doesNotMatch(JSON.stringify(report), /1234567|private stderr marker|stdout|stderr/);
});

test('model name alone and missing command evidence never establish laptop eligibility', async () => {
  assert.equal((await collect("Now drawing from 'AC Power'\n")).eligibility.status, 'ineligible');
  const missing = await collect('', { runCommand: async () => { throw Object.assign(new Error('private exception text'), { code: 'ENOENT' }); } });
  assert.equal(missing.eligibility.status, 'unknown'); assert.equal(missing.hardware.model, null); assert.equal(missing.power.internalBattery, 'unknown');
  assert.deepEqual(missing.evidence.power, { status: 'unavailable', reason: 'command-failed' }); assert.doesNotMatch(JSON.stringify(missing), /private exception text/);
  for (const [error, reason] of [[{ killed: true }, 'timeout'], [{ code: 'ETIMEDOUT' }, 'timeout'], [{ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true }, 'output-limit']]) {
    const result = await collect('', { runCommand: async () => { throw error; } });
    assert.equal(result.eligibility.status, 'unknown'); assert.equal(result.evidence.power.reason, reason);
  }
  assert.equal((await collect('unexpected power response')).eligibility.status, 'unknown');
});

test('unsupported platform does not invoke macOS commands, and unsupported architecture cannot pass', async () => {
  const linux = await collect('', { system: { ...system, platform: 'linux' }, runCommand: async () => { assert.fail('macOS command on unsupported platform'); } });
  assert.equal(linux.eligibility.status, 'ineligible'); assert.equal(linux.power.internalBattery, 'unknown'); assert.equal(linux.evidence.power.status, 'not-run');
  const intel = await collect(battery('Battery Power', '40%; discharging; present: true'), { system: { ...system, architecture: 'x64' } });
  assert.equal(intel.power.internalBattery, 'present'); assert.equal(intel.eligibility.status, 'ineligible');
  const unidentified = await collect('', { system: { platform: undefined }, runCommand: async () => { assert.fail('Commands require known macOS'); } });
  assert.equal(unidentified.eligibility.status, 'unknown'); assert.equal(unidentified.hardware.memoryBytes, null);
});

test('CLI prints readable JSON and requires confirmed eligibility only with --require-laptop', async () => {
  for (const status of ['eligible', 'ineligible', 'unknown']) for (const requireLaptop of [false, true]) {
    let output = '', errors = '';
    const code = await runHardwarePreflightCLI(requireLaptop ? ['--require-laptop'] : [], { collect: async () => ({ status: 'preflight-only', eligibility: { status } }), stdout: value => { output += value; }, stderr: value => { errors += value; } });
    assert.equal(code, requireLaptop && status !== 'eligible' ? 2 : 0); assert.equal(JSON.parse(output).eligibility.status, status); assert.match(output, /\n  "status"/); assert.equal(errors, '');
  }
  let output = '', errors = '';
  const code = await runHardwarePreflightCLI(['--arbitrary-command'], { collect: async () => assert.fail('Invalid args must not collect'), stdout: value => { output += value; }, stderr: value => { errors += value; } });
  assert.equal(code, 1); assert.equal(output, ''); assert.match(errors, /^Usage:/);
});

test('import is silent and does not run the CLI', async () => {
  const url = new URL('../scripts/hardware-preflight.mjs', import.meta.url).href;
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url)});`], { timeout: 3000, maxBuffer: 16384 });
  assert.equal(stdout, ''); assert.equal(stderr, '');
});
