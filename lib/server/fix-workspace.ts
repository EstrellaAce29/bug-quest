import 'server-only';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { applyPipelinePatch } from '../pipeline-patch';
import type { FixCheckpoint } from '../auto-fix';
import type { FixProposal } from '../quest-contract';

const exec = promisify(execFile);
const gitBinary = process.platform === 'darwin' ? '/usr/bin/git' : 'git';

export function createFixWorkspace(root = process.cwd(), options?: { file: string; patch: typeof applyPipelinePatch; validate: (signal: AbortSignal) => Promise<void> }) {
  const relativeFile = options?.file ?? 'lib/pipeline.ts';
  const file = path.join(root, relativeFile);
  const config = path.join(root, 'config/bugs.json');
  let head = '';
  let expectedSource = '';
  let originalConfig: Buffer;
  let committed = false;
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  delete childEnv.OPENAI_API_KEY;
  for (const name of Object.keys(childEnv)) if (/PASSWORD|TOKEN|SECRET|KEY/.test(name)) delete childEnv[name];
  async function git(args: string[]) {
    const result = await exec(gitBinary, args, { cwd: root, env: childEnv, timeout: 30000, maxBuffer: 1024 * 1024 });
    return result.stdout.trim();
  }
  async function unchanged() {
    if (await git(['rev-parse', 'HEAD']) !== head) throw new Error('Git HEAD changed outside the auto-fix transaction.');
    if (await readFile(file, 'utf8') !== expectedSource) throw new Error('The pipeline file changed outside the auto-fix transaction.');
    if (!(await readFile(config)).equals(originalConfig)) throw new Error('config/bugs.json changed outside the auto-fix transaction.');
  }
  return {
    async checkpoint(): Promise<FixCheckpoint> {
      if ((await lstat(file)).isSymbolicLink()) throw new Error('The pipeline path must be a regular tracked file.');
      head = await git(['rev-parse', 'HEAD']);
      // Preserve unrelated work and refuse to auto-commit pre-existing changes to this file.
      await git(['diff', '--quiet', head, '--', relativeFile]);
      await git(['diff', '--quiet', '--cached', '--', relativeFile]);
      expectedSource = await readFile(file, 'utf8');
      const committedSource = (await exec(gitBinary, ['show', `${head}:${relativeFile}`], { cwd: root, env: childEnv })).stdout;
      if (committedSource !== expectedSource) throw new Error('The pipeline must match its committed version.');
      originalConfig = await readFile(config);
      const tree = await git(['rev-parse', `${head}^{tree}`]);
      const commit = await git(['commit-tree', tree, '-p', head, '-m', 'checkpoint: Bug Quest auto-fix']);
      await git(['update-ref', `refs/bug-quest/checkpoints/${randomUUID()}`, commit]);
      return { commit, source: expectedSource };
    },
    async apply(checkpoint: FixCheckpoint, proposal: FixProposal) {
      await unchanged();
      const patch = (options?.patch ?? applyPipelinePatch)(checkpoint.source, proposal);
      await writeFile(file, patch.source);
      expectedSource = patch.source;
      return patch.diff;
    },
    async validate(signal: AbortSignal) {
      await unchanged(); signal.throwIfAborted();
      if (options) { await options.validate(signal); await unchanged(); return; }
      try {
        await exec(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit'], { cwd: root, env: childEnv, timeout: 60000, signal, maxBuffer: 1024 * 1024 });
      } catch { throw new Error('Candidate failed TypeScript validation.'); }
      const tests = (await readdir(path.join(root, 'tests'))).filter(name => name.endsWith('.test.ts')).map(name => path.join(root, 'tests', name));
      try {
        await exec(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), '--test', ...tests], { cwd: root, env: childEnv, timeout: 60000, signal, maxBuffer: 1024 * 1024 });
      } catch { throw new Error('Candidate failed the regression tests.'); }
      await unchanged();
    },
    async restore(checkpoint: FixCheckpoint) {
      if (committed) return;
      // Never reset the branch/index or overwrite another person's file edits.
      if (await git(['rev-parse', 'HEAD']) !== head || await readFile(file, 'utf8') !== expectedSource) throw new Error('Concurrent repository change; checkpoint retained for recovery.');
      await writeFile(file, checkpoint.source);
      expectedSource = checkpoint.source;
    },
    async commit(_checkpoint: FixCheckpoint, description: string) {
      await unchanged();
      const short = description.replace(/[^a-zA-Z0-9 .,()_-]/g, '').trim().slice(0, 80) || 'preserve pipeline invariants';
      await git(['commit', '--only', '-m', `auto-fix: ${short}`, '--', relativeFile]);
      committed = true;
      return git(['rev-parse', 'HEAD']);
    },
  };
}
