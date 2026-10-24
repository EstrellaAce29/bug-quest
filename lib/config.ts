import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Bugs, RunSeed } from './pipeline';
export async function readBugs(): Promise<Bugs> {
  return JSON.parse(await readFile(path.join(process.cwd(), 'config/bugs.json'), 'utf8'));
}
export async function readSeed(): Promise<RunSeed> {
  return JSON.parse(await readFile(path.join(process.cwd(), 'data/pipeline-runs.json'), 'utf8'));
}
