import type { CodeDiffLine, FixProposal, FixReport, LiveResult } from './quest-contract';

export type FixCheckpoint = { commit: string; source: string };
export type RepairDependencies = {
  checkpoint: () => Promise<FixCheckpoint>;
  propose: (input: { source: string; failure: LiveResult; attempt: number; feedback: string }, signal: AbortSignal) => Promise<FixProposal>;
  apply: (checkpoint: FixCheckpoint, proposal: FixProposal) => Promise<CodeDiffLine[]>;
  validate: (signal: AbortSignal) => Promise<void>;
  restore: (checkpoint: FixCheckpoint) => Promise<void>;
  commit: (checkpoint: FixCheckpoint, description: string) => Promise<string>;
  run: (check: Pick<LiveResult, 'id' | 'title' | 'objective' | 'kind'>, signal: AbortSignal, log: (message: string) => void) => Promise<LiveResult>;
};

export async function attemptAutoFix(
  failure: LiveResult,
  basic: Pick<LiveResult, 'id' | 'title' | 'objective' | 'kind'>,
  dependencies: RepairDependencies,
  signal: AbortSignal,
  log: (message: string) => void,
  update: (report: FixReport) => void,
): Promise<FixReport> {
  const report: FixReport = { checkId: failure.id, status: 'fixing', checkpoint: null, commit: null, attempts: [], diff: [], afterResult: null, basicResult: null, message: 'Preparing a Git checkpoint.' };
  let checkpoint: FixCheckpoint;
  try {
    signal.throwIfAborted();
    checkpoint = await dependencies.checkpoint();
    report.checkpoint = checkpoint.commit;
    log(`saved Git checkpoint ${checkpoint.commit.slice(0, 7)}.`);
  } catch {
    if (signal.aborted) signal.throwIfAborted();
    report.status = 'escalated'; report.message = 'Escalated to human: could not create a safe checkpoint. Commit any existing changes to the selected pipeline file first.';
    update(structuredClone(report)); log(report.message); return report;
  }
  let feedback = '';
  for (let number = 1; number <= 3; number++) {
    const attempt = { number, description: '', precise: null as LiveResult | null, basic: null as LiveResult | null, error: null as string | null, diff: [] as CodeDiffLine[] };
    report.attempts.push(attempt);
    try {
      signal.throwIfAborted();
      log(`fix attempt ${number} of 3...`);
      const proposal = await dependencies.propose({ source: checkpoint.source, failure, attempt: number, feedback }, signal);
      signal.throwIfAborted();
      attempt.description = proposal.description;
      attempt.diff = await dependencies.apply(checkpoint, proposal);
      report.diff = attempt.diff;
      report.message = `Fix attempt ${number} of 3: validating the code change.`;
      update(structuredClone(report));
      log('applied a minimal change to the selected pipeline file; validating code...');
      await dependencies.validate(signal);
      log('Re-verifying with Kane...');
      // Objective text and flags are unchanged; only the display title identifies the rerun.
      attempt.precise = await dependencies.run({ id: failure.id, title: `${failure.title} (after fix ${number})`, objective: failure.objective, kind: failure.kind }, signal, log);
      report.afterResult = attempt.precise;
      if (attempt.precise.status !== 'passed') throw new Error(`Precise re-verification did not pass: ${attempt.precise.summary}`);
      log('re-running the original basic check unchanged...');
      attempt.basic = await dependencies.run({ ...basic, title: 'Basic instruction (after fix)' }, signal, log);
      report.basicResult = attempt.basic;
      if (attempt.basic.status !== 'passed') throw new Error(`The basic check no longer passes: ${attempt.basic.summary}`);
      signal.throwIfAborted();
      report.commit = await dependencies.commit(checkpoint, proposal.description);
      report.status = 'fixed'; report.message = 'Fixed and verified';
      update(structuredClone(report));
      log(`Fixed and verified. Committed ${report.commit.slice(0, 7)}.`);
      return report;
    } catch (error) {
      // Restoration intentionally does not use the aborted request signal.
      try { await dependencies.restore(checkpoint); }
      catch {
        report.status = 'escalated';
        report.message = `Escalated to human: rollback could not be fully confirmed. Git checkpoint: ${checkpoint.commit}. Review the pipeline file and any active run before continuing.`;
        update(structuredClone(report)); log(report.message); return report;
      }
      if (signal.aborted) { log('cancelled; restored the pipeline file from the checkpoint.'); signal.throwIfAborted(); }
      feedback = error instanceof Error ? error.message.slice(0, 2000) : 'Candidate could not be verified.';
      attempt.error = feedback;
      report.message = `Attempt ${number} failed; original code restored.`;
      update(structuredClone(report)); log(report.message);
    }
  }
  report.status = 'escalated';
  report.message = 'Escalated to human';
  update(structuredClone(report));
  log('Escalated to human. All 3 attempts failed; original code restored. Evidence links are in Live results.');
  return report;
}
