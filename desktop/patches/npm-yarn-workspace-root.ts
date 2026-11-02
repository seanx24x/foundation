/*!
 * Asynchronous adaptation of find-yarn-workspace-root 2.0.0.
 * Copyright 2017 Square, Inc. Licensed under Apache-2.0.
 * Adapted from:
 * https://github.com/yarnpkg/yarn/blob/ddf2f9ade211195372236c2f39a75b00fa18d4de/src/config.js#L612
 * Foundation modification: await filesystem probes and manifest reads so a
 * protected ancestor folder cannot block the extension host's event loop.
 * See FoundationThirdPartyNotices.txt for the license.
 */
import { promises as fs } from 'fs';
import * as path from 'path';

// Keep the exact matcher already locked by npm's find-yarn-workspace-root
// dependency. Minimatch changes ordered negations and POSIX character classes.
const match: (files: string[], patterns: string | string[]) => string[] = require('../node_modules/micromatch');

async function readManifest(directory: string) {
	const file = path.join(directory, 'package.json');
	try {
		// Preserve existsSync semantics: inaccessible/missing entries are skipped,
		// while a read or JSON failure after a successful probe aborts the search.
		await fs.stat(file);
	} catch {
		return null;
	}
	return JSON.parse(await fs.readFile(file, 'utf8'));
}

export async function findWorkspaceRoot(initial?: string): Promise<string | null> {
	const start = initial || process.cwd();
	let directory = path.normalize(start);
	while (true) {
		const manifest = await readManifest(directory);
		const declaration = (manifest || {}).workspaces;
		const patterns = (declaration && declaration.packages) || (Array.isArray(declaration) ? declaration : null);
		if (patterns) {
			const relative = path.relative(directory, start);
			// The nearest workspace is authoritative, including a non-match.
			return relative === '' || match([relative], patterns).length > 0 ? directory : null;
		}
		const parent = path.dirname(directory);
		if (parent === directory) return null;
		directory = parent;
	}
}

// Preserve an inspectable runtime marker through the bundled/minified build.
Object.defineProperty(findWorkspaceRoot, 'foundationPatch', { value: 'foundation.npm.async-yarn-workspace-root.v1' });
