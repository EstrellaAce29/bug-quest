// Validate intent before any model, browser, stage registration, or pipeline work.
export function validateQuestLaunch(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('Provide an agent name and a check.');
  const input = value as Record<string, unknown>;
  if (typeof input.agent !== 'string' || !input.agent.trim() || input.agent.length > 80) throw new Error('Name your agent (up to 80 characters).');
  if (typeof input.instruction !== 'string' || !input.instruction.trim() || input.instruction.length > 1000) throw new Error('What should your agent check? Enter a check of up to 1,000 characters.');
  if (input.confirmed !== true) throw new Error('Click Run or confirm with Enter in the CLI before starting a quest.');
  if (input.watchKane !== undefined && input.watchKane !== false) throw new Error('Kane runs headlessly. Visible browser mode is unavailable.');
  if (input.target !== undefined && input.target !== 'airflow' && input.target !== 'simulated') throw new Error('Choose Simulated monitor or Real Airflow.');
  return { agent: input.agent.trim(), instruction: input.instruction.trim(), target: (input.target ?? 'simulated') as QuestTarget };
}

export type QuestTarget = 'simulated' | 'airflow';
export type ObjectiveKind = 'row_conservation' | 'task_status';
export type ExpandedObjective = { title: string; objective: string; kind: ObjectiveKind; expectsBug?: boolean };
export type LiveResult = {
  id: number;
  title: string;
  objective: string;
  kind: 'basic' | ObjectiveKind;
  status: 'passed' | 'failed' | 'error';
  resultCode: number | null;
  summary: string;
  testUrl: string | null;
  credits: number | null;
  confirmedBug: boolean;
  expectsBug?: boolean;
  falseAlarm?: boolean;
  sql?: { runId: string; extractedRows: number; matchesLoaded: number; totalWins: number };
  source?: 'kane' | 'sql' | 'kane+sql';
};
export type CodeDiffLine = { kind: 'context' | 'removed' | 'added'; text: string };
export type FixProposal = { description: string; edits: { oldText: string; newText: string }[] };
export type FixAttempt = { number: number; description: string; precise: LiveResult | null; basic: LiveResult | null; error: string | null; diff: CodeDiffLine[] };
export type FixReport = {
  checkId: number;
  status: 'fixing' | 'fixed' | 'escalated';
  checkpoint: string | null;
  commit: string | null;
  attempts: FixAttempt[];
  diff: CodeDiffLine[];
  afterResult: LiveResult | null;
  basicResult: LiveResult | null;
  message: string;
};
export type LiveEvent =
  | { type: 'log'; message: string }
  | { type: 'plan'; objectives: ExpandedObjective[] }
  | { type: 'result'; result: LiveResult; bugsFound: number; points: number; fixesVerified?: number; falseAlarms?: number }
  | { type: 'fix'; report: FixReport; bugsFound: number; fixesVerified: number; points: number; falseAlarms?: number }
  | { type: 'done'; bugsFound: number; points: number; fixesVerified?: number; escalated?: boolean; falseAlarms?: number }
  | { type: 'error'; message: string };

export function validatePlan(value: unknown): ExpandedObjective[] {
  if (!value || typeof value !== 'object' || !('objectives' in value) || !Array.isArray(value.objectives)) {
    throw new Error('OpenAI did not return a valid objective plan.');
  }
  const objectives = value.objectives;
  if (objectives.length < 2 || objectives.length > 3 || objectives.some(item =>
    !item || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 120 ||
    typeof item.objective !== 'string' || !item.objective.trim() || item.objective.length > 3000 ||
    !['row_conservation', 'task_status'].includes(item.kind) || (item.expectsBug !== undefined && typeof item.expectsBug !== 'boolean'))) {
    throw new Error('OpenAI must return two or three bounded pipeline checks.');
  }
  if (!objectives.some(item => item.kind === 'row_conservation') || !objectives.some(item => item.kind === 'task_status')) {
    throw new Error('The objective plan must cover row conservation and task statuses.');
  }
  return objectives;
}

// Several checks of the same invariant still describe one silent bug.
export function silentBugKinds(results: LiveResult[]): Set<ObjectiveKind> {
  if (results.find(result => result.kind === 'basic')?.status !== 'passed') return new Set();
  return new Set(results.filter(result => result.kind !== 'basic' && result.status === 'failed' && result.confirmedBug)
    .map(result => result.kind as ObjectiveKind));
}

export function redact(text: string, secrets: string[] = []): string {
  let safe = text;
  for (const secret of secrets) if (secret) safe = safe.split(secret).join('[redacted]');
  return safe.replace(/\bsk-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
}

export function testManagerUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['test-manager.lambdatest.com', 'test-manager.testmuai.com'].includes(url.hostname) ? url.href : null;
  } catch { return null; }
}
