import { silentBugKinds, type ExpandedObjective, type LiveEvent, type LiveResult, type FixReport } from './quest-contract';

type Check = Pick<LiveResult, 'id' | 'title' | 'objective' | 'kind'>;
type Dependencies = {
  expand: (instruction: string, signal: AbortSignal) => Promise<ExpandedObjective[]>;
  run: (check: Check, signal: AbortSignal, log: (message: string) => void) => Promise<LiveResult>;
  repair?: (failure: LiveResult, basic: Check, signal: AbortSignal, log: (message: string) => void, update: (report: FixReport) => void) => Promise<FixReport>;
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
  const repairs = new Map<number, FixReport>();
  const scores = () => {
    const bugsFound = silentBugKinds(results).size;
    const fixesVerified = [...repairs.values()].filter(report => report.status === 'fixed').length;
    return { bugsFound, fixesVerified, points: bugsFound * 20 + fixesVerified * 15 };
  };
  for (const check of checks) {
    signal.throwIfAborted();
    log(check.kind === 'basic' ? 'running the original instruction as-is...' : `running check ${check.id} of ${objectives.length}...`);
    const result = await dependencies.run(check, signal, log);
    results.push(result);
    emit({ type: 'result', result, ...scores() });
    log(`${check.title}: ${result.status.toUpperCase()}${result.resultCode === null ? '' : ` (code ${result.resultCode})`}.`);
    if (result.status === 'error') throw new Error(result.summary);
    if (result.kind !== 'basic' && result.status === 'failed' && dependencies.repair) {
      const update = (report: FixReport) => { repairs.set(result.id, report); emit({ type: 'fix', report, ...scores() }); };
      const report = await dependencies.repair(result, checks[0], signal, log, update);
      if (report.status === 'escalated') {
        emit({ type: 'done', ...scores(), escalated: true }); return;
      }
    }
  }
  const score = scores();
  log(`quest complete. ${score.bugsFound} silent bug${score.bugsFound === 1 ? '' : 's'} caught; ${score.fixesVerified} fixes verified; ${score.points} points.`);
  emit({ type: 'done', ...score });
}

export function kaneArguments(objective: string): string[] {
  return ['run', objective, '--url', 'http://localhost:3000/pipelines', '--agent', '--max-steps', '15'];
}
