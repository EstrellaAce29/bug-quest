import { silentBugKinds, type ExpandedObjective, type LiveEvent, type LiveResult, type FixReport } from './quest-contract';
import { QUEST_TIMEOUTS, withQuestTimeout } from './quest-timeout';

type Check = Pick<LiveResult, 'id' | 'title' | 'objective' | 'kind' | 'expectsBug'>;
export type QuestDependencies = {
  expand: (instruction: string, signal: AbortSignal) => Promise<ExpandedObjective[]>;
  run: (check: Check, signal: AbortSignal, log: (message: string) => void) => Promise<LiveResult>;
  repair?: (failure: LiveResult, basic: Check, signal: AbortSignal, log: (message: string) => void, update: (report: FixReport) => void) => Promise<FixReport>;
};

export async function executeQuest(
  input: { agent: string; instruction: string },
  dependencies: QuestDependencies,
  signal: AbortSignal,
  emit: (event: LiveEvent) => void,
  timeouts = QUEST_TIMEOUTS,
) {
  const log = (message: string) => emit({ type: 'log', message: `${input.agent}: ${message}` });
  log('expanding your instruction with OpenAI...');
  const objectives = await withQuestTimeout('OpenAI objective expansion', timeouts.openAI, signal, stepSignal => dependencies.expand(input.instruction, stepSignal));
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
    const falseAlarms = new Set(results.filter(r => r.falseAlarm).map(r => r.kind)).size;
    return { bugsFound, fixesVerified, falseAlarms, points: bugsFound * 20 + fixesVerified * 15 - falseAlarms * 5 };
  };
  for (const check of checks) {
    signal.throwIfAborted();
    log(check.kind === 'basic' ? 'running the original instruction as-is...' : `running check ${check.id} of ${objectives.length}...`);
    // Simulated row checks also use Kane; real SQL applies its own shorter limit.
    const raw = await withQuestTimeout('Kane headless check', timeouts.kane, signal, stepSignal => dependencies.run(check, stepSignal, log));
    const result = { ...raw, falseAlarm: check.kind !== 'basic' && check.expectsBug === true && raw.status === 'passed' };
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

export function kaneArguments(objective: string, url = 'http://localhost:3000/pipelines'): string[] {
  return ['run', objective, '--url', url, '--agent', '--max-steps', '15', '--headless'];
}
