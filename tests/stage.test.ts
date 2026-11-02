import { test } from 'node:test';
import assert from 'node:assert/strict';
import { animalForName, createStage, beginStageRun, recordStageEvent, stageView, resetStage, finishStageRun } from '../lib/stage';
import { ANIMALS } from '../lib/play-character.mjs';
import { executeQuest } from '../lib/quest-engine';
import type { LiveResult, LiveEvent, FixReport } from '../lib/quest-contract';

const basic: LiveResult = { id: 0, title: 'Basic', objective: 'Check the pipeline ran', kind: 'basic', status: 'passed', resultCode: 100, summary: 'Passed', testUrl: null, credits: 1, confirmedBug: false };
const fix: FixReport = { checkId: 1, status: 'fixed', checkpoint: 'checkpoint', commit: 'fix', attempts: [], diff: [], afterResult: basic, basicResult: basic, message: 'Fixed and verified' };

test('animals are deterministic across case and whitespace and come from the shared eight', () => {
  assert.equal(ANIMALS.length, 8);
  assert.deepEqual(animalForName('  Winter  '), animalForName('winter'));
  assert.deepEqual(animalForName('Winter  Fox'), animalForName('winter fox'));
  for (const name of ['Winter', 'Blaze', 'Moss', 'Juniper', 'Pebble', 'Fox 🦊']) assert.ok(ANIMALS.includes(animalForName(name).animal));
});

test('watching an empty stage creates no agents or awards', () => {
  const stage = createStage();
  assert.deepEqual(stageView(stage), { generation: 0, agents: [], standings: [], awards: [], cursor: 0 });
});

test('confirmed catch, verified fix and false alarm award once despite repeated progress', () => {
  const stage = createStage(); const run = beginStageRun(stage, 'Winter', 'run1');
  const caught: LiveEvent = { type: 'result', result: { ...basic, id: 1, kind: 'row_conservation', status: 'failed', confirmedBug: true }, bugsFound: 1, fixesVerified: 0, points: 20 };
  recordStageEvent(stage, run, caught, 1000); recordStageEvent(stage, run, caught, 1100);
  const fixing: LiveEvent = { type: 'fix', report: { ...fix, status: 'fixing' }, bugsFound: 1, fixesVerified: 0, points: 20 };
  recordStageEvent(stage, run, fixing); assert.equal(stageView(stage).agents[0].phase, 'fixing');
  const fixed: LiveEvent = { ...fixing, report: fix, fixesVerified: 1, points: 35 };
  recordStageEvent(stage, run, fixed, 2000); recordStageEvent(stage, run, fixed, 2100);
  const alarm: LiveEvent = { ...caught, falseAlarms: 1, fixesVerified: 1, points: 30 };
  recordStageEvent(stage, run, alarm, 3000); recordStageEvent(stage, run, alarm, 3100);
  assert.equal(stageView(stage).agents[0].points, 30);
  assert.deepEqual(stageView(stage).awards.map(a => a.amount), [20, 15, -5]);
  assert.deepEqual(stageView(stage, 2).awards.map(a => a.amount), [15, -5]);
});

test('completed agents stay ranked and repeated runs accumulate without a second character', () => {
  const stage = createStage(); const winter = beginStageRun(stage, 'Winter', 'run1');
  recordStageEvent(stage, winter, { type: 'done', bugsFound: 1, fixesVerified: 0, points: 20 });
  const blaze = beginStageRun(stage, 'Blaze', 'run2');
  recordStageEvent(stage, blaze, { type: 'done', bugsFound: 1, fixesVerified: 1, points: 35 });
  assert.deepEqual(stageView(stage).standings.map(a => a.name), ['Blaze', 'Winter']);
  const again = beginStageRun(stage, 'winter', 'run3');
  recordStageEvent(stage, again, { type: 'done', bugsFound: 1, fixesVerified: 0, points: 20 });
  assert.equal(stageView(stage).agents.length, 2);
  assert.equal(stageView(stage).standings[0].name, 'Winter');
  assert.equal(stageView(stage).standings[0].points, 40);
  assert.equal(stageView(stage).standings[0].runs, 2);
  recordStageEvent(stage, winter, { type: 'done', bugsFound: 2, points: 40 });
  assert.equal(stageView(stage).standings[0].points, 40);
});

test('reset clears the session and late events cannot resurrect previous agents', () => {
  const stage = createStage(); const old = beginStageRun(stage, 'Winter', 'run1');
  resetStage(stage); const fresh = beginStageRun(stage, 'Blaze', 'run2');
  recordStageEvent(stage, old, { type: 'done', bugsFound: 1, fixesVerified: 1, points: 35 }); finishStageRun(stage, old);
  assert.deepEqual(stageView(stage).agents.map(a => a.name), ['Blaze']);
  assert.equal(stageView(stage).agents[0].points, 0);
  recordStageEvent(stage, fresh, { type: 'done', bugsFound: 0, points: 0 });
  assert.equal(stageView(stage).agents[0].phase, 'idle');
});

test('errors and cancellation stop thinking without awarding a false alarm', () => {
  const stage = createStage(); const run = beginStageRun(stage, 'Winter', 'run1');
  finishStageRun(stage, run);
  assert.equal(stageView(stage).agents[0].phase, 'stopped');
  assert.equal(stageView(stage).agents[0].points, 0);
  const next = beginStageRun(stage, 'Winter', 'run2');
  recordStageEvent(stage, next, { type: 'error', message: 'Private infrastructure details' });
  assert.equal(stageView(stage).agents[0].phase, 'stopped');
  assert.equal(stageView(stage).awards.length, 0);
  assert.ok(!JSON.stringify(stageView(stage)).includes('Private infrastructure details'));
});

test('stage views are detached snapshots and expose no run handles or private instructions', () => {
  const stage = createStage(); beginStageRun(stage, 'Winter', 'private-run-id');
  const view = stageView(stage); view.agents[0].points = 999;
  assert.equal(stageView(stage).agents[0].points, 0);
  assert.ok(!JSON.stringify(view).includes('private-run-id'));
  assert.equal('runs' in view, false);
});

test('quest engine drives stage catch and fix awards without page-side scoring', async () => {
  const stage = createStage(); const handle = beginStageRun(stage, 'Winter', 'run1');
  await executeQuest({ agent: 'Winter', instruction: 'Check the pipeline ran' }, {
    expand: async () => [{ title: 'Rows', objective: 'Verify rows', kind: 'row_conservation' }, { title: 'Tasks', objective: 'Verify tasks', kind: 'task_status' }],
    run: async check => ({ ...basic, ...check, status: check.kind === 'row_conservation' ? 'failed' : 'passed', confirmedBug: check.kind === 'row_conservation' }),
    repair: async (_, __, ___, ____, update) => { update(fix); update(fix); return fix; },
  }, new AbortController().signal, e => recordStageEvent(stage, handle, e));
  const view = stageView(stage);
  assert.equal(view.agents[0].phase, 'idle');
  assert.equal(view.agents[0].points, 35);
  assert.deepEqual(view.awards.map(a => a.amount), [20, 15]);
});

test('only an explicit disproven bug claim earns -5; normal passes and errors do not', async () => {
  for (const [expectsBug, status, expected] of [[false, 'passed', 0], [true, 'passed', -5], [true, 'error', 0]] as const) {
    const stage = createStage(); const handle = beginStageRun(stage, 'Winter', 'run1');
    await executeQuest({ agent: 'Winter', instruction: 'Instruction' }, {
      expand: async () => [{ title: 'Rows', objective: 'Verify rows', kind: 'row_conservation', expectsBug }, { title: 'Tasks', objective: 'Verify tasks', kind: 'task_status' }],
      run: async check => ({ ...basic, ...check, status: check.kind === 'row_conservation' ? status : 'passed' }),
    }, new AbortController().signal, e => recordStageEvent(stage, handle, e)).catch(() => {});
    assert.equal(stageView(stage).agents[0].points, expected);
    assert.equal(stageView(stage).agents[0].falseAlarms, expected === -5 ? 1 : 0);
  }
});
