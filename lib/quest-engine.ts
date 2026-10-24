import { silentBugKinds, type ExpandedObjective, type LiveEvent, type LiveResult } from './quest-contract';

type Check = Pick<LiveResult, 'id' | 'title' | 'objective' | 'kind'>;
type Dependencies = {
  expand: (instruction: string, signal: AbortSignal) => Promise<ExpandedObjective[]>;
  run: (check: Check, signal: AbortSignal, log: (message: string) => void) => Promise<LiveResult>;
};

export async function executeQuest(
  input: { agent: string; instruction: string },
  dependencies: Dependencies,
  signal: AbortSignal,
  emit: (event: LiveEvent) => void,
) {
  const log = (message: string) => emit({ type: 'log', message: `${input.agent}: ${message}` });
  log('expanding your instruction with OpenAI...');
  const objectives = await dependencies.expand(input.instruction, signal);
  emit({ type: 'plan', objectives });
  log(`generated ${objectives.length} precise checks.`);
  const checks: Check[] = [
    { id: 0, title: 'Basic instruction', objective: input.instruction, kind: 'basic' },
    ...objectives.map((item, index) => ({ ...item, id: index + 1 })),
  ];
  const results: LiveResult[] = [];
  for (const check of checks) {
    signal.throwIfAborted();
    log(check.kind === 'basic' ? 'running the original instruction as-is...' : `running check ${check.id} of ${objectives.length}...`);
    const result = await dependencies.run(check, signal, log);
    results.push(result);
    const bugsFound = silentBugKinds(results).size;
    emit({ type: 'result', result, bugsFound, points: bugsFound * 20 });
    log(`${check.title}: ${result.status.toUpperCase()}${result.resultCode === null ? '' : ` (code ${result.resultCode})`}.`);
    if (result.status === 'error') throw new Error(result.summary);
  }
  const bugsFound = silentBugKinds(results).size;
  log(`quest complete. ${bugsFound} silent bug${bugsFound === 1 ? '' : 's'} caught; ${bugsFound * 20} points.`);
  emit({ type: 'done', bugsFound, points: bugsFound * 20 });
}

export function kaneArguments(objective: string): string[] {
  return ['run', objective, '--url', 'http://localhost:3000/pipelines', '--agent', '--max-steps', '15'];
}
