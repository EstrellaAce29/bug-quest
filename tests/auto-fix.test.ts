import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attemptAutoFix, type RepairDependencies } from '../lib/auto-fix';
import { applyPipelinePatch } from '../lib/pipeline-patch';
import type { LiveResult, FixReport } from '../lib/quest-contract';

const failure: LiveResult = { id: 1, title: 'Rows', objective: 'Verify load rows equal extract rows (1000).', kind: 'row_conservation', status: 'failed', resultCode: 740, summary: 'Extract 1000, load 500.', testUrl: 'https://test-manager.lambdatest.com/failure', credits: 2, confirmedBug: true };
const basic = { id: 0, title: 'Basic', objective: 'Check the pipeline ran', kind: 'basic' as const };
const passed = { ...failure, status: 'passed' as const, resultCode: 100, confirmedBug: false };

function fixture(overrides: Partial<RepairDependencies> = {}) {
  let source = 'original';
  let commits = 0;
  let restores = 0;
  const seen: string[] = [];
  const dependencies: RepairDependencies = {
    checkpoint: async () => ({ commit: 'a'.repeat(40), source }),
    propose: async input => { assert.equal(input.source, 'original'); return { description: 'preserve full batch', edits: [{ oldText: 'original', newText: 'fixed' }] }; },
    apply: async () => { source = 'fixed'; return [{ kind: 'removed', text: 'original' }, { kind: 'added', text: 'fixed' }]; },
    validate: async () => {},
    restore: async checkpoint => { source = checkpoint.source; restores++; },
    commit: async () => { commits++; return 'b'.repeat(40); },
    run: async check => { seen.push(check.objective); return { ...passed, ...check }; },
    ...overrides,
  };
  return { dependencies, seen, state: () => ({ source, commits, restores }) };
}

test('a fix commits only after the identical precise objective and original basic instruction pass', async () => {
  const f = fixture();
  const updates: FixReport[] = [];
  const report = await attemptAutoFix(failure, basic, f.dependencies, new AbortController().signal, () => {}, update => updates.push(update));
  assert.equal(report.status, 'fixed');
  assert.equal(report.attempts.length, 1);
  assert.deepEqual(f.seen, [failure.objective, basic.objective]);
  assert.deepEqual(f.state(), { source: 'fixed', commits: 1, restores: 0 });
  assert.equal(updates.at(-1)?.commit, 'b'.repeat(40));
});

test('three failed precise checks restore the original after each attempt and escalate with evidence', async () => {
  const f = fixture({ run: async check => ({ ...failure, ...check }) });
  const report = await attemptAutoFix(failure, basic, f.dependencies, new AbortController().signal, () => {}, () => {});
  assert.equal(report.status, 'escalated');
  assert.equal(report.message, 'Escalated to human');
  assert.equal(report.attempts.length, 3);
  assert.ok(report.attempts.every(attempt => attempt.precise?.testUrl === failure.testUrl));
  assert.deepEqual(f.state(), { source: 'original', commits: 0, restores: 3 });
});

test('a passing precise check with a broken basic check never commits', async () => {
  const f = fixture({ run: async check => ({ ...(check.kind === 'basic' ? failure : passed), ...check }) });
  const report = await attemptAutoFix(failure, basic, f.dependencies, new AbortController().signal, () => {}, () => {});
  assert.equal(report.status, 'escalated');
  assert.ok(report.attempts.every(attempt => attempt.precise?.status === 'passed' && attempt.basic?.status === 'failed'));
  assert.deepEqual(f.state(), { source: 'original', commits: 0, restores: 3 });
});

test('invalid candidates and type errors are rolled back without running Kane', async () => {
  let launched = 0;
  const f = fixture({ validate: async () => { throw new Error('TypeScript error'); }, run: async () => { launched++; return passed; } });
  const report = await attemptAutoFix(failure, basic, f.dependencies, new AbortController().signal, () => {}, () => {});
  assert.equal(report.status, 'escalated'); assert.equal(launched, 0);
  assert.deepEqual(f.state(), { source: 'original', commits: 0, restores: 3 });
});

test('cancelling after an edit rolls back before propagating cancellation', async () => {
  const controller = new AbortController();
  const f = fixture({ validate: async () => { controller.abort(); controller.signal.throwIfAborted(); } });
  await assert.rejects(() => attemptAutoFix(failure, basic, f.dependencies, controller.signal, () => {}, () => {}));
  assert.deepEqual(f.state(), { source: 'original', commits: 0, restores: 1 });
});

test('a commit failure rolls back the candidate and never awards a verified fix', async () => {
  const f = fixture({ commit: async () => { throw new Error('Git commit failed'); } });
  const report = await attemptAutoFix(failure, basic, f.dependencies, new AbortController().signal, () => {}, () => {});
  assert.equal(report.status, 'escalated');
  assert.deepEqual(f.state(), { source: 'original', commits: 0, restores: 3 });
});

const buggy = "bugs.rowMismatchBug ? sourceRows.slice(0, Math.ceil(sourceRows.length / 2)) : sourceRows";
// A stable copy of the real faulty expression survives future changes to the production file.
const source = `export function simulateRun(bugs: { rowMismatchBug: boolean }) {
  const sourceRows = [1, 2];
  const loadBatch = ${buggy};
  return loadBatch;
}`;

test('the real one-expression repair produces a minimal before/after diff', () => {
  const result = applyPipelinePatch(source, { description: 'load all source rows', edits: [{ oldText: buggy, newText: 'sourceRows' }] });
  assert.ok(result.source.includes('const loadBatch = sourceRows;'));
  assert.equal(result.diff.filter(line => line.kind === 'removed').length, 1);
  assert.equal(result.diff.filter(line => line.kind === 'added').length, 1);
});

test('patches cannot change declarations, disable switches, introduce system calls, or match ambiguously', () => {
  for (const newText of ['process.env.OPENAI_API_KEY', 'fetch("https://example.com")', 'eval("x")', 'bugs.rowMismatchBug = false', 'require("node:fs")']) {
    assert.throws(() => applyPipelinePatch(source, { description: 'bad patch', edits: [{ oldText: buggy, newText }] }));
  }
  assert.throws(() => applyPipelinePatch(source, { description: 'bad patch', edits: [{ oldText: 'return', newText: 'throw' }] }));
  assert.throws(() => applyPipelinePatch(source, { description: 'bad patch', edits: [{ oldText: 'export function overallStatus', newText: 'export function different' }] }));
});
