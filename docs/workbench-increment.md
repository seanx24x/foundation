# Foundation 0.2 — local project workbench

## What this increment makes real

Foundation now works with a folder of source files, alongside the original connected
fixture walkthrough. The project service, source intelligence, and assistant protocol
are independent of the React interface so a future Code OSS host can reuse them.
This remains a local web workbench; it is not yet a packaged desktop IDE.

The included Orbit project is a small React app with a profile form, a Save component,
an API module, and shared style tokens. Its Refine preview imports these exact files
through the development server. Source changes are saved to disk and reflected in
that preview. Explicit element instrumentation maps three components to their source.
That mapping is limited to the included sample, not inferred for other repositories.

## Daily workflow

1. Open the included Orbit project, or use **Open folder** with an absolute local path.
2. Explore real files, use **Cmd/Ctrl+P** to open a file, or **Cmd/Ctrl+Shift+F** to search.
3. In **Understand**, follow the selected file's imports and consumers. Symbols and
   detected fetch calls link to their source lines. These relationships come from
   parsed source; they do not claim that a request occurred or a backend was traced.
4. In **Build**, edit multiple files. Each tab retains its own draft and original saved
   revision. **Cmd/Ctrl+S** saves the active file. A conflicting disk change blocks a
   save and preserves the draft for comparison.
5. In **Refine**, use the included sample's desktop/mobile preview, theme, and element
   inspection. Follow shared styles into their source. Other folders show their style
   files and an explicit unconnected preview state.
6. In **Review**, inspect the exact before/after text for saved edits made through
   Foundation in this server session. Revert is revision guarded and does not run Git.
7. In **Assistant**, select saved source files, inspect what will be shared, and ask a
   configured provider a question. Stop cancels the upstream request. Answers are AI
   interpretation and source links retain their original revisions.

The **Connected walkthrough** remains available for the original request → scripted
proposal → apply → independent checks → undo demonstration. Its source and request
history are separate from the multi-file sample. Switching between the two workspaces
preserves mounted editor drafts. Reloading the browser still requires saving drafts.

## Source and change ownership

The local service permits UTF-8 source files within the explicitly opened project.
It excludes hidden files/directories, credential-like names, generated/dependency
folders, unsupported extensions, symbolic links, binary files, and ignored paths.
The current `.gitignore` reader is deliberately conservative: negation rules do not
reinclude files. It is not a replacement for a full Git-aware indexer.

Every save carries the active project identity, path, and original source revision.
Foundation serializes saves and rejects stale writes. Its session change journal
records the before and last-written source for each edited file. A revert requires the
current disk source to match the last Foundation write. Explicitly reloading and then
editing an external change establishes a fresh baseline so unrelated changes survive
reversion. Session records are in memory; source edits persist across server restarts.
This journal is not a Git diff, commit, backup, or durable review history.

The inventory is bounded to 1,500 files and 8 MiB; individual files to 256 KiB;
search to 200 matches. The UI reports incomplete indexes/results. Relative imports
are resolved over this inventory. Package imports, TypeScript path aliases, dynamic
imports with expressions, and unsupported language analysis are not resolved into
invented relationships. External editor changes are discovered by refresh/reopen;
a continuous filesystem watcher is still future work.

## AI boundary

The assistant is a real server-side integration with a streaming, OpenAI-compatible
Chat Completions endpoint. It has no tools, write permission, background retrieval,
or automatic execution. The only source shared is the saved, revision-checked context
selected in the panel. Drafts are excluded. Provider credentials remain in process
configuration and are never returned to the browser. See [provider setup](ai-provider.md).

The assistant preserves partial answers on cancellation and provider failure. Usage
appears only when the provider reports it. Citation links must point to an included
source ID and a real line; a valid link establishes provenance, not the truth of the
model's interpretation. No live commercial provider connection is assumed by tests.

## Next engineering gate

This increment creates a useful local workflow and clearer host-independent contracts.
Before calling Foundation a personal alpha, complete the Code OSS host spike, durable
change/review storage, incremental indexing, isolated provider-generated proposals,
and integration with debugger/terminal/extension workflows. Native adapters remain
separate feasibility work. A general-purpose visual adapter needs validated mapping
and instrumented request evidence beyond the sample. None of those capabilities is
implied by a working web preview.
