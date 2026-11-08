import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUEST_TIMEOUTS, QuestTimeoutError, withQuestTimeout } from '../lib/quest-timeout';
import { consumeQuestStream } from '../lib/quest-stream';
import { executeQuest } from '../lib/quest-engine';
import { attemptAutoFix } from '../lib/auto-fix';
import type { LiveResult } from '../lib/quest-contract';

const never = () => new Promise<never>(() => {});

test('deadline rejects even when an operation never settles or ignores cancellation', async () => {
  let child: AbortSignal | undefined;
  await assert.rejects(withQuestTimeout('Kane headless check', 5, new AbortController().signal, signal => { child = signal; return never(); }), /Kane headless check timed out after 0.005 seconds/);
  assert.equal(child?.aborted, true);
});

test('deadline preserves the clear step error when aborting fetch yields a generic AbortError', async () => {
  await assert.rejects(withQuestTimeout('OpenAI objective expansion', 5, new AbortController().signal, signal => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))), QuestTimeoutError);
});

test('Cancel promptly interrupts uncooperative work and prevents launching pre-aborted work', async () => {
  const controller = new AbortController();
  const result = withQuestTimeout('Kane', 1000, controller.signal, never);
  controller.abort(new Error('User cancelled'));
  await assert.rejects(result, /User cancelled/);
  await assert.rejects(withQuestTimeout('OpenAI', 1000, controller.signal, async () => { assert.fail('No new work after cancellation'); }), /User cancelled/);
});

test('stream watchdog stops a silent stream and requests cancellation', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  await assert.rejects(consumeQuestStream(body, new AbortController().signal, () => {}, 5), /Quest progress stream.*timed out/);
  assert.equal(cancelled, true);
});

test('Cancel interrupts a pending stream read without waiting for its underlying cancel promise', async () => {
  const controller = new AbortController();
  const body = new ReadableStream<Uint8Array>({ cancel: never });
  const result = consumeQuestStream(body, controller.signal, () => {}, 1000);
  controller.abort(new Error('User cancelled'));
  await assert.rejects(result, /User cancelled/);
});

test('split UTF-8 progress is parsed; a terminal event finishes even if the server leaves the connection open', async () => {
  const bytes = new TextEncoder().encode('{"type":"log","message":"Working 🐻"}\n{"type":"done","points":0,"bugsFound":0}\n');
  const body = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); } });
  const messages: string[] = [];
  await consumeQuestStream(body, new AbortController().signal, event => messages.push(event.type === 'log' ? event.message : event.type), 100);
  assert.deepEqual(messages, ['Working 🐻', 'done']);
});

test('OpenAI expansion timeout prevents later billable browser checks', async () => {
  const logs: string[] = [];
  await assert.rejects(executeQuest({ agent: 'PC', instruction: 'Verify all rows' }, {
    expand: never,
    run: async () => { assert.fail('Kane must not run after expansion times out'); },
  }, new AbortController().signal, event => { if (event.type === 'log') logs.push(event.message); }, { ...QUEST_TIMEOUTS, openAI: 5 }), /OpenAI objective expansion timed out/);
  assert.match(logs[0], /expanding/);
});

test('Kane timeout stops the queue even if the subprocess never emits close', async () => {
  let runs = 0;
  await assert.rejects(executeQuest({ agent: 'PC', instruction: 'Verify all rows' }, {
    expand: async () => [{ title: 'Rows', objective: 'Check rows', kind: 'row_conservation' }, { title: 'Tasks', objective: 'Check tasks', kind: 'task_status' }],
    run: () => { runs++; return never(); },
  }, new AbortController().signal, () => {}, { ...QUEST_TIMEOUTS, kane: 5 }), /Kane headless check timed out/);
  assert.equal(runs, 1);
});

test('simulated row-conservation browser checks retain the Kane limit rather than the SQL limit', async () => {
  let completed = false;
  await executeQuest({ agent: 'PC', instruction: 'Verify all rows' }, {
    expand: async () => [{ title: 'Rows', objective: 'Check rows', kind: 'row_conservation' }, { title: 'Tasks', objective: 'Check tasks', kind: 'task_status' }],
    run: async check => {
      if (check.kind === 'row_conservation') await new Promise(resolve => setTimeout(resolve, 10));
      return { ...check, status: 'passed', resultCode: 100, summary: 'Passed', testUrl: null, credits: 0, confirmedBug: false };
    },
  }, new AbortController().signal, event => { if (event.type === 'done') completed = true; }, { ...QUEST_TIMEOUTS, warehouse: 1, kane: 100 });
  assert.equal(completed, true);
});

test('DAG timeout restores the source before surfacing the error and never commits or retries', async () => {
  const failure = { id: 1, kind: 'row_conservation', title: 'Rows', objective: 'Check rows' } as LiveResult;
  let restores = 0, proposals = 0;
  await assert.rejects(attemptAutoFix(failure, failure, {
    checkpoint: async () => ({ commit: 'checkpoint', source: 'original' }),
    propose: async () => { proposals++; return { description: 'Load all rows', edits: [] }; },
    apply: async () => [],
    validate: signal => withQuestTimeout('Airflow DAG completion', 5, signal, never),
    restore: async () => { restores++; },
    commit: async () => { assert.fail('Cannot commit after a DAG timeout'); },
    run: async () => { assert.fail('Cannot verify after a DAG timeout'); },
  }, new AbortController().signal, () => {}, () => {}), /Airflow DAG completion timed out/);
  assert.equal(restores, 1); assert.equal(proposals, 1);
});
