import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, silentBugKinds, testManagerUrl, validatePlan, type LiveResult } from '../lib/quest-contract';
import { executeQuest, kaneArguments } from '../lib/quest-engine';
import type { LiveEvent, ExpandedObjective } from '../lib/quest-contract';

const basic: LiveResult = { id: 0, title: 'Basic', objective: 'Check the pipeline ran', kind: 'basic', status: 'passed', resultCode: 100, summary: 'Completed', testUrl: null, credits: 2, confirmedBug: false };
const caught: LiveResult = { ...basic, id: 1, kind: 'row_conservation', status: 'failed', resultCode: 740, confirmedBug: true };

test('silent-bug scoring requires a passing basic check and a confirmed precise failure', () => {
  assert.equal(silentBugKinds([basic, caught]).size * 20, 20);
  assert.equal(silentBugKinds([{ ...basic, status: 'failed' }, caught]).size, 0);
  assert.equal(silentBugKinds([basic, { ...caught, status: 'error' }]).size, 0);
  assert.equal(silentBugKinds([basic, { ...caught, confirmedBug: false }]).size, 0);
  assert.equal(silentBugKinds([basic, caught, { ...caught, id: 2 }]).size * 20, 20);
});

test('only bounded plans covering both invariants are accepted', () => {
  const plan = { objectives: [
    { title: 'Rows', objective: 'Verify load and extract both show 1000 rows.', kind: 'row_conservation' },
    { title: 'Statuses', objective: 'If DAG is Success, verify all six tasks are success.', kind: 'task_status' },
  ] };
  assert.equal(validatePlan(plan).length, 2);
  assert.throws(() => validatePlan({ objectives: plan.objectives.slice(0, 1) }));
  assert.throws(() => validatePlan({ objectives: [plan.objectives[0], plan.objectives[0]] }));
  assert.throws(() => validatePlan({ objectives: [...plan.objectives, ...plan.objectives] }));
  assert.throws(() => validatePlan({ objectives: [{ ...plan.objectives[0], objective: '' }, plan.objectives[1]] }));
});

test('outgoing messages remove exact API keys, bearer values and terminal escape characters', () => {
  const secret = 'test-private-value';
  assert.equal(redact(`error: ${secret}`, [secret]), 'error: [redacted]');
  assert.equal(redact('sk-fake_not_a_real_key Bearer fake-token'), '[redacted] Bearer [redacted]');
  assert.equal(redact('\u001b[31mhello'), '[31mhello');
});

test('result links allow only HTTPS Test Manager destinations', () => {
  assert.equal(testManagerUrl('https://test-manager.lambdatest.com/projects/1'), 'https://test-manager.lambdatest.com/projects/1');
  assert.equal(testManagerUrl('javascript:alert(1)'), null);
  assert.equal(testManagerUrl('https://evil.example/?key=secret'), null);
  assert.equal(testManagerUrl('http://test-manager.lambdatest.com/'), null);
});

test('original instruction runs verbatim before expanded objectives, without overlapping executions', async () => {
  const instruction = '  Check the pipeline ran; $(do-not-execute)  ';
  const objectives: ExpandedObjective[] = [
    { title: 'Rows', objective: 'Verify load equals extract (1000).', kind: 'row_conservation' },
    { title: 'Statuses', objective: 'Verify successful DAG task statuses.', kind: 'task_status' },
  ];
  const events: LiveEvent[] = [];
  const seen: string[] = [];
  let active = 0;
  await executeQuest({ agent: 'Winter', instruction }, {
    expand: async received => { assert.equal(received, instruction); return objectives; },
    run: async check => {
      active++; assert.equal(active, 1); seen.push(check.objective);
      await new Promise(resolve => setImmediate(resolve)); active--;
      return { ...(check.kind === 'row_conservation' ? caught : basic), ...check };
    },
  }, new AbortController().signal, event => events.push(event));
  assert.deepEqual(seen, [instruction, ...objectives.map(item => item.objective)]);
  assert.deepEqual(events.at(-1), { type: 'done', bugsFound: 1, points: 20 });
  assert.ok(events.some(event => event.type === 'log' && event.message === 'Winter: running check 2 of 2...'));
  assert.deepEqual(kaneArguments(instruction), ['run', instruction, '--url', 'http://localhost:3000/pipelines', '--agent', '--max-steps', '15']);
});

test('infrastructure failures retain partial results and prevent later billable runs', async () => {
  const events: LiveEvent[] = [];
  let launched = 0;
  await assert.rejects(() => executeQuest({ agent: 'Winter', instruction: 'Check the pipeline ran' }, {
    expand: async () => [{ title: 'Rows', objective: 'Check rows', kind: 'row_conservation' }, { title: 'Status', objective: 'Check status', kind: 'task_status' }],
    run: async check => { launched++; return { ...basic, ...check, status: 'error', summary: 'Chrome unavailable' }; },
  }, new AbortController().signal, event => events.push(event)), /Chrome unavailable/);
  assert.equal(launched, 1);
  assert.ok(events.some(event => event.type === 'result' && event.result.status === 'error'));
  assert.ok(!events.some(event => event.type === 'done'));
});

test('cancellation stops the queue before the next check', async () => {
  const controller = new AbortController();
  let launched = 0;
  await assert.rejects(() => executeQuest({ agent: 'Winter', instruction: 'Check pipeline' }, {
    expand: async () => [{ title: 'Rows', objective: 'Check rows', kind: 'row_conservation' }, { title: 'Status', objective: 'Check status', kind: 'task_status' }],
    run: async check => { launched++; controller.abort(); return { ...basic, ...check }; },
  }, controller.signal, () => {}));
  assert.equal(launched, 1);
});
