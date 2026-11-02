# Isolated tool checks — Foundation 0.17

A staged change group can be checked before it touches the source project. Open its review, choose **Prepare workspace**, select an available check, then choose **Run check**. Preparation copies saved project inputs to Foundation-owned storage and overlays the group's exact proposed source. It does not execute project code. Each prepared copy supports one explicit run; another run starts with a fresh copy.

## Supported checks and boundaries

| Check | Availability | Meaning of success |
| --- | --- | --- |
| Node tests | Up to 64 local JavaScript files named `*.test.js`, `*.spec.js`, or their `.mjs`/`.cjs` equivalents. | The Node test command exited with zero against the copied inputs. |
| TypeScript check | Root `tsconfig.json` and a regular local `node_modules/typescript/lib/tsc.js` installation. | The copied TypeScript compiler exited with zero using `--noEmit --pretty false`. |

Foundation passes fixed arguments to its bundled Node runtime. Renderer messages choose task identities; they cannot supply a shell command, executable, working directory or environment. Node tests run without subprocess isolation, and subprocess creation is blocked. Arbitrary package scripts, package installation, network-dependent tests, monorepo/path-linked dependencies and tools requiring child processes remain unsupported. An unavailable macOS execution boundary disables execution; there is no unrestricted fallback.

The macOS process policy blocks network access, child processes, IPC delegation and signals to other processes. It confines file writes to the owned copy, apart from `/dev/null`. **Tools retain local file read access.** This is not a confidentiality sandbox or an environment for untrusted code. The UI exposes that boundary before Run. Foundation supplies a small environment without inherited provider credentials. Output remains local and is never automatically appended to an AI request.

## Saved inputs and source authority

Preparation reads saved bytes, not native editor buffers. It rejects changed, missing or dirty contributing source. An unrelated unsaved draft remains outside the copy. Local dependencies are copied as regular files rather than linked back to the project. Symbolic links, special files, oversized files and unsupported paths fail preparation instead of being followed.

The snapshot excludes repository metadata, known credential/configuration files, environment files, caches and build output. This is a fixed exclusion policy, not automatic secret detection. Projects that depend on excluded inputs need a later explicit environment workflow. Limits are 32,768 scanned directory entries, 512 MiB total and 16 MiB per file. Empty directories count toward the entry limit. Exceeding a limit is visible and leaves the original project untouched.

Each record retains its group identity, immutable content digest, group revision, copied-source digest, file/byte counts, exact command, timestamps, output and process outcome. Before execution, Foundation rechecks the original saved project and copied input manifest. A check that edits or removes an existing copied input cannot produce a passing result for the staged snapshot. Newly generated output stays in the copy and is not offered as a source proposal.

Apply remains a separate decision. It still requires the existing source and native-draft guards. A command result does not change the group's original AI verification claims or grant permission to apply it. Source mutations and new Build requests wait while a check owns the current group; ordinary editing, inspection and supported questions remain usable.

## Progress, Stop and recovery

Output is displayed as text, capped at 64 KiB, with truncation made visible. Runs stop after 60 seconds. Explicit Stop, loss of workspace trust, a project change, removal of the owning surface, an archived owning conversation or conflicting contributing source retires the operation and terminates its owned process. Collapsing the Assistant and browsing another conversation do not cancel it. Starting the next check from Assistant still requires its owning active conversation.

Execution records are independent of conversation history and source checkpoints. Reopening preserves completed outcomes. A previously prepared or running record becomes Interrupted and cannot resume or reuse a process identity. Prepare a fresh copy to run again. Failed storage remains visible and blocks new work until retry succeeds.

Previous results are retained chronologically, with twelve previous records plus the current record. At capacity, existing records are preserved and new preparation stops. Retention/export controls remain an open product gate. Replacing a prepared copy removes only its owned generated files; the prior result record remains.

## Saved check plans — 0.20

A prepared workspace can supply an ordered plan of its supported checks. Each explicit Run next or Retry uses a fresh copy of the complete recorded snapshot; Skip and End do not execute commands. The plan pauses between checks and restores its next decision after restart. Previous attempts and their output remain separate evidence. See [saved check plans](check-plans.md) for source identity, storage recovery and capacity.

## Evidence

Command success means exit status for the recorded snapshot. It does not prove behavior, visual quality, accessibility or that all relevant tests exist. Interaction and visual checks remain independently Not run. The running checklist records session/host/renderer tests, real restricted-process checks, packaged Prepare/Run/Stop/restart and installed source/draft preservation separately.

The 0.20 check-plan increment adds durable decisions for these fixed recipes. Broader agent steering, additional tools, dependent partial acceptance and general verification orchestration remain open. Neither isolated checks nor check plans add a Git worktree or automatically execute model-selected tools.
