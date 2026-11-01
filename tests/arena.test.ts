import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { chooseBugs, detectedBugs, runArenaRound, scoreFindings, validateArenaPlan, validatePlayers, type ArenaDependencies, type ArenaEvent, type ArenaSnapshot, type ArenaBug } from '../lib/arena';

const players = validatePlayers([{ name: 'Rows', strategy: 'Compare row counts' }, { name: 'Wins', strategy: 'Check standings totals' }]);
const snapshot = (bugs: ArenaBug[] = []): ArenaSnapshot => ({ runId: 'arena_abc', counts: { runId: 'arena_abc', extractedRows: 2986, matchesLoaded: bugs.includes('half_load') ? 1493 : 2986, totalWins: (bugs.includes('half_load') ? 1493 : 2986) - (bugs.includes('standings_loss') ? 179 : 0), otherRunRows: 0 }, duplicates: 0 });

function harness() {
  const prepared: ArenaBug[][] = [];
  let resets = 0;
  const deps: ArenaDependencies = {
    prepare: async bugs => { prepared.push([...bugs]); return snapshot(bugs); },
    expand: async strategy => [{ title: strategy, objective: strategy, invariant: strategy.includes('row') ? 'rows' : 'wins', expectsBug: false }],
    inspect: async check => ({ invariant: check.invariant, reportedBug: true, summary: 'SQL invariant failed.' }),
    repair: async caught => caught,
    reset: async () => { resets++; return 'arena_clean'; },
  };
  return { deps, prepared, get resets() { return resets; } };
}

test('Arena accepts 2–4 unique agents and bounded coaching; rejects tampered rosters and plans', () => {
  assert.equal(players.length, 2);
  for (const value of [[], [players[0]], [...players, ...players, players[0]], [{ name: 'X', strategy: 'rows' }, { name: 'x', strategy: 'wins' }], [{ name: 'X', strategy: '' }, players[1]]]) assert.throws(() => validatePlayers(value));
  const check = { title: 'Rows', objective: 'Compare rows', invariant: 'rows', expectsBug: false };
  assert.equal(validateArenaPlan({ checks: [check] }).length, 1);
  assert.throws(() => validateArenaPlan({ checks: [check, check] }));
  assert.throws(() => validateArenaPlan({ checks: [{ ...check, invariant: 'shell' }] }));
  assert.throws(() => validateArenaPlan({ checks: [{ ...check, expectsBug: 'true' }] }));
});

test('secret fault sampling covers every nonempty 1–2 fault combination', () => {
  assert.deepEqual(chooseBugs(() => 1), ['half_load', 'standings_loss']);
  for (let second = 0; second < 2; second++) { let calls = 0; assert.deepEqual(chooseBugs(() => calls++ ? second : 0), [second ? 'standings_loss' : 'half_load']); }
  assert.deepEqual(detectedBugs(snapshot(['half_load', 'standings_loss'])), ['half_load', 'standings_loss']);
  assert.deepEqual(detectedBugs(snapshot()), []);
});

test('scoring deduplicates bugs and false alarms; only caught, independently verified fixes earn points', () => {
  const findings = [
    { invariant: 'rows' as const, reportedBug: true, summary: 'Loss' },
    { invariant: 'rows' as const, reportedBug: true, summary: 'Same loss' },
    { invariant: 'duplicates' as const, reportedBug: true, summary: 'False claim' },
    { invariant: 'duplicates' as const, reportedBug: true, summary: 'Repeated claim' },
    { invariant: 'tasks' as const, reportedBug: true, error: true, summary: 'Infrastructure outage' },
    { invariant: 'wins' as const, reportedBug: false, summary: 'Normal pass' },
  ];
  const score = scoreFindings('p', ['half_load'], findings, ['half_load', 'half_load', 'standings_loss']);
  assert.equal(score.points, 30); assert.equal(score.falseAlarms, 1);
  assert.deepEqual(score.caught, ['half_load']); assert.deepEqual(score.fixed, ['half_load']);
  assert.equal(scoreFindings('p', [], findings).points, -10);
});

test('each player receives the original faults, with independent repairs and no early fault reveal', async () => {
  const h = harness(); const events: ArenaEvent[] = [];
  const summary = await runArenaRound(1, players, ['half_load', 'standings_loss'], h.deps, new AbortController().signal, e => events.push(e));
  assert.deepEqual(h.prepared, [['half_load', 'standings_loss'], ['half_load', 'standings_loss']]);
  assert.equal(h.resets, 1); assert.equal(summary.resetRunId, 'arena_clean');
  assert.deepEqual(summary.scores.map(s => s.points), [35, 35]);
  assert.deepEqual(summary.scores.map(s => s.caught), [['half_load'], ['standings_loss']]);
  assert.equal(events.at(-1)?.type, 'summary');
  assert.ok(events.filter(e => e.type !== 'summary').every(e => !JSON.stringify(e).includes('half_load') && !JSON.stringify(e).includes('standings_loss')));
});

test('cancellation, browser failure and model failure always reset; no incomplete round is revealed', async () => {
  for (const where of ['prepare', 'expand', 'inspect', 'repair'] as const) {
    const h = harness(); const events: ArenaEvent[] = [];
    h.deps[where] = async () => { throw new Error(`Failed ${where}`); };
    await assert.rejects(runArenaRound(1, players, ['half_load'], h.deps, new AbortController().signal, e => events.push(e)), /Failed/);
    assert.equal(h.resets, 1); assert.ok(!events.some(e => e.type === 'summary'));
  }
  const h = harness(); const abort = new AbortController(); abort.abort();
  await assert.rejects(runArenaRound(1, players, ['half_load'], h.deps, abort.signal, () => {}));
  assert.equal(h.resets, 1); assert.equal(h.prepared.length, 0);
});

test('a failed reset prevents summary/completion and cannot award unverified repair points', async () => {
  const h = harness(); const events: ArenaEvent[] = [];
  h.deps.reset = async () => { throw new Error('Recovery required'); };
  await assert.rejects(runArenaRound(1, players, ['half_load'], h.deps, new AbortController().signal, e => events.push(e)), /Recovery required/);
  assert.ok(!events.some(e => e.type === 'summary'));
  const noRepair = harness(); noRepair.deps.repair = async () => [];
  const summary = await runArenaRound(1, players, ['half_load'], noRepair.deps, new AbortController().signal, () => {});
  assert.equal(summary.scores[0].points, 20);
});

test('the Python fault parser preserves ordinary demo behavior and validates Arena opt-in', () => {
  const source = readFileSync('real-pipeline/dags/tennis_tournament_pipeline.py', 'utf8');
  const script = `import ast,json,sys\nsource=ast.parse(sys.stdin.read())\nf=next(n for n in source.body if isinstance(n,ast.FunctionDef) and n.name=='arena_faults')\nns={}\nexec(compile(ast.Module(body=[f],type_ignores=[]),'faults','exec'),ns)\nclass Run: pass\nr=Run()\nns['get_current_context']=lambda:{'dag_run':r}\nr.conf={}\nassert ns['arena_faults']() is None\nr.conf={'bug_quest_arena':{'half_load':False,'standings_loss':False}}\nassert ns['arena_faults']()=={'half_load':False,'standings_loss':False}\nfor bad in [{'half_load':True},{'half_load':'false','standings_loss':False},[]]:\n r.conf={'bug_quest_arena':bad}\n try: ns['arena_faults'](); raise AssertionError('accepted bad config')\n except ValueError: pass\n`;
  const result = spawnSync('python3', ['-c', script], { input: source, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(source.includes('        matches_to_load = matches[:len(matches) // 2]\n'));
});

test('three successive rounds retain the same roster, accept edited coaching, and reset every round', async () => {
  const h = harness();
  const summaries = [];
  for (let round = 1; round <= 3; round++) {
    const coached = players.map(p => ({ ...p, strategy: round === 2 ? 'Compare row counts' : p.strategy }));
    summaries.push(await runArenaRound(round, coached, ['half_load', 'standings_loss'], h.deps, new AbortController().signal, () => {}));
  }
  assert.deepEqual(summaries.map(s => s.round), [1, 2, 3]);
  assert.equal(h.resets, 3);
  assert.deepEqual(summaries[1].scores.map(s => s.caught), [['half_load'], ['half_load']]);
  assert.equal(summaries.flatMap(s => s.scores).reduce((n, s) => n + s.points, 0), 210);
});
