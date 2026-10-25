import { test } from 'node:test';
import assert from 'node:assert/strict';
import seed from '../data/pipeline-runs.json';
import { overallStatus, simulateRun, type Bugs } from '../lib/pipeline';

const defaults: Bugs = {
  falseSuccessBug: false,
  rowMismatchBug: false,
  stuckDeferredBug: false,
  slowApiBug: false,
  silentErrorBug: false,
};

test('default run time follows each request while manual runs and deferred ages stay relative', () => {
  const now = Date.parse('2026-10-24T22:00:00.000Z');
  for (const requestTime of [now, now + 3600000]) {
    const run = simulateRun(seed, defaults, undefined, requestTime);
    assert.equal(Date.parse(run.startedAt), requestTime - 10 * 60 * 1000);
    const deferred = simulateRun(seed, { ...defaults, stuckDeferredBug: true }, undefined, requestTime);
    assert.equal(deferred.tasks[0].durationSeconds, 7 * 60 * 60);
  }
  const manualStart = new Date(now - 3000).toISOString();
  assert.equal(simulateRun(seed, defaults, manualStart, now).startedAt, manualStart);
});

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
test('regression: load must preserve all extracted rows even when the bug switch remains enabled', () => {
  const run = simulateRun(seed, { ...defaults, rowMismatchBug: true });
  assert.equal(run.tasks.find(task => task.id === 'extract')?.rows, 1000);
  assert.equal(run.tasks.find(task => task.id === 'load')?.rows, 1000);
});
test('deferred fault ignores unfinished sensor in the completion gate', () => {
  const run = simulateRun(seed, { ...defaults, stuckDeferredBug: true });
  assert.equal(run.tasks[0].status, 'deferred');
  assert.ok(run.tasks[0].durationSeconds >= 6 * 3600);
  assert.equal(run.status, 'success');
  assert.equal(overallStatus(run.tasks, defaults), 'running');
});
