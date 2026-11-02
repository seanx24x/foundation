import { access } from 'node:fs/promises';
import path from 'node:path';
import { app, root, run } from './common.mjs';
await access(app);
const project = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'projects/orbit');
await run('open', ['-a', app, '--args', project]);
