import { stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, desktop, pin, root, run, assertAppStopped } from './common.mjs';
import { validateDevelopmentExtension, validateHost } from './extension-workflow.mjs';

export async function launchDevelopment(options) {
  const { app, desktop, pin, root, run, assertAppStopped, bundle, args = [], warn = console.warn } = options;
  if (args.length > 1 || args.some(argument => argument.startsWith('-'))) {
    throw new Error('Usage: npm run desktop:dev -- [project-folder]');
  }
  // Launch Services can ignore new process arguments when an app is already running.
  // Require a normal quit; never force-quit or manipulate ordinary draft backups.
  assertAppStopped();
  await validateHost(app, pin);
  const extension = await validateDevelopmentExtension(desktop, root);
  const project = args[0] ? path.resolve(args[0]) : path.join(root, 'projects/orbit');
  if (!(await stat(project)).isDirectory()) throw new Error('The development project must be an existing folder.');
  await bundle();
  await validateDevelopmentExtension(desktop, root);
  assertAppStopped();
  console.log('Launching Foundation with the local development extension. The packaged app and its signature are unchanged.');
  warn('Development windows do not restore ordinary unsaved drafts. Their own unsaved edits have memory-only backups and can be lost on exit. Use this mode for saved-source verification.');
  warn('To return to your ordinary drafts, quit this development window normally, then run npm run desktop:launch -- <same-project-folder>. The launcher does not save, discard, or copy draft backups.');
  // Do not override the regular profile or trust configuration. Code OSS deliberately
  // omits a disk backupPath for development windows; ordinary drafts remain separate.
  // The explicit development extension overrides the built-in extension.
  await run('open', ['-a', app, '--args', `--extensionDevelopmentPath=${extension}`, project]);
  return { extension, project };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await launchDevelopment({ app, desktop, pin, root, run, assertAppStopped, args: process.argv.slice(2),
    bundle: () => run('node', [path.join(desktop, 'scripts/bundle-extension.mjs')]),
  });
}
