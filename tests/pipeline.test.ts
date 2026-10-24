import { test } from 'node:test';
import assert from 'node:assert/strict';
import seed from '../data/pipeline-runs.json';
import defaults from '../config/bugs.json';
import { overallStatus, simulateRun } from '../lib/pipeline';

test('healthy run conserves rows from extract through load', () => {
  const run = simulateRun(seed, defaults);
  assert.equal(run.status, 'success');
  assert.equal(run.tasks.length, 6);
  assert.ok(run.tasks.every(task => task.status === 'success'));
  assert.equal(run.tasks.find(task => task.id === 'extract')?.rows, 1000);
  assert.equal(run.tasks.find(task => task.id === 'load')?.rows, 1000);
});
test('a newly triggered run progresses to completion', () => {
  const start = '2026-10-24T20:00:00.000Z';
  const now = Date.parse(start);
  const initial = simulateRun(seed, defaults, start, now);
  assert.equal(initial.status, 'running');
  assert.equal(initial.tasks[0].status, 'running');
  assert.equal(initial.tasks[1].status, 'skipped');
  const middle = simulateRun(seed, defaults, start, now + 2500);
  assert.equal(middle.tasks[1].status, 'success');
  assert.equal(middle.tasks[2].status, 'running');
  const final = simulateRun(seed, defaults, start, now + 6000);
  assert.equal(final.status, 'success');
  assert.ok(final.runId.startsWith('manual__'));
});
test('false-success fault masks a real failed warehouse write', () => {
  const run = simulateRun(seed, { ...defaults, falseSuccessBug: true });
  assert.equal(run.tasks.find(task => task.id === 'load')?.status, 'failed');
  assert.equal(run.status, 'success');
  assert.equal(overallStatus(run.tasks, defaults), 'failed');
});
test('row mismatch fault truncates the load batch', () => {
  const run = simulateRun(seed, { ...defaults, rowMismatchBug: true });
  assert.equal(run.tasks.find(task => task.id === 'extract')?.rows, 1000);
  assert.equal(run.tasks.find(task => task.id === 'load')?.rows, 500);
});
test('deferred fault ignores unfinished sensor in the completion gate', () => {
  const run = simulateRun(seed, { ...defaults, stuckDeferredBug: true });
  assert.equal(run.tasks[0].status, 'deferred');
  assert.ok(run.tasks[0].durationSeconds >= 6 * 3600);
  assert.equal(run.status, 'success');
  assert.equal(overallStatus(run.tasks, defaults), 'running');
});
