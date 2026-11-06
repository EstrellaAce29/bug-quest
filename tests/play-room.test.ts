import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, joinRoom, submitStrategy, roomView, requireHost, startRoom, recordRoomEvent, finishRoomJob, canStartRoom } from '../lib/play-room';
import { runPlayRound, type PlayDependencies } from '../lib/play';

function lobby() {
  const room = createRoom('ABCD23', 'host-only', 2, 1000);
  const one = joinRoom(room, 'Moss', 'token-moss', 1000);
  const two = joinRoom(room, 'Coral', 'token-coral', 1000);
  submitStrategy(room, one.token, 1, 'Compare rows', 1000);
  submitStrategy(room, two.token, 1, 'Compare wins', 1000);
  return { room, one, two };
}

test('room invitations expose neither host nor player tokens; controllers cannot impersonate the host', () => {
  const { room } = lobby();
  const data = JSON.stringify(roomView(room, 0, undefined, 1000));
  for (const secret of ['host-only', 'token-moss', 'token-coral', 'Compare rows']) assert.ok(!data.includes(secret));
  assert.throws(() => requireHost(room, 'token-moss'));
  assert.throws(() => requireHost(room, 'ABCD23'));
  assert.throws(() => roomView(room, 0, 'fake-player', 1000));
  requireHost(room, 'host-only');
});

test('start requires two present, coached controllers; roster and strategies lock during play', () => {
  const { room, one } = lobby();
  assert.equal(canStartRoom(room, 1000), true);
  assert.equal(canStartRoom(room, 17000), false);
  assert.throws(() => startRoom(room, 'host-only', 2, 1000));
  assert.equal(room.phase, 'lobby');
  startRoom(room, 'host-only', 1, 1000);
  assert.equal(room.phase, 'running');
  assert.throws(() => joinRoom(room, 'Late', 'late', 1000));
  assert.throws(() => submitStrategy(room, one.token, 1, 'Change mid-round', 1000));
});

test('live awards update ranks without double-counting turn scores or confirmed round totals', () => {
  const { room, one, two } = lobby();
  startRoom(room, 'host-only', 1, 1000);
  recordRoomEvent(room, { type: 'award', playerId: one.id, amount: -5, reason: 'false_alarm' }, 1100);
  assert.equal(roomView(room, 0, undefined, 1100).standings[0].playerId, two.id);
  recordRoomEvent(room, { type: 'award', playerId: two.id, amount: 20, reason: 'catch' }, 1200);
  recordRoomEvent(room, { type: 'award', playerId: two.id, amount: 15, reason: 'fix' }, 1300);
  recordRoomEvent(room, { type: 'score', score: { playerId: two.id, points: 35, caught: 1, fixed: 1, falseAlarms: 0 } }, 1400);
  assert.equal(roomView(room, 0, undefined, 1400).standings[0].points, 35);
  recordRoomEvent(room, { type: 'summary', summary: { round: 1, planted: ['half_load'], resetRunId: 'clean-1', scores: [{ playerId: one.id, caught: [], fixed: [], falseAlarms: 1, points: -5 }, { playerId: two.id, caught: ['half_load'], fixed: ['half_load'], falseAlarms: 0, points: 35 }] } }, 1500);
  assert.deepEqual(roomView(room, 0, undefined, 1500).standings.map(s => s.points), [35, -5]);
});

test('poll cursors and controller sessions filter turn events without exposing hidden faults early', () => {
  const { room, one, two } = lobby();
  recordRoomEvent(room, { type: 'log', playerId: one.id, message: 'Moss checking' }, 1100);
  recordRoomEvent(room, { type: 'log', playerId: two.id, message: 'Coral checking' }, 1200);
  recordRoomEvent(room, { type: 'log', playerId: null, message: 'Resetting both faults' }, 1300);
  const own = roomView(room, 1, one.token, 1400);
  assert.deepEqual(own.events.map(e => e.seq), [3]);
  assert.equal(own.cursor, 3);
  assert.equal(one.lastSeen, 1400);
  assert.deepEqual(roomView(room, 3, one.token, 1500).events, []);
});

test('three rounds accept fresh terminal strategies, retain roster, reveal only after reset and finish', async () => {
  const { room, one, two } = lobby();
  let reset = 0;
  const deps: PlayDependencies = {
    prepare: async () => ({ runId: 'round-run', counts: { runId: 'round-run', extractedRows: 1000, matchesLoaded: 500, totalWins: 500, otherRunRows: 0 }, duplicates: 0 }),
    expand: async () => [{ title: 'Rows', objective: 'Compare extracted and loaded rows', invariant: 'rows', expectsBug: false }],
    inspect: async () => ({ invariant: 'rows', reportedBug: true, summary: 'Rows lost' }),
    repair: async caught => caught,
    reset: async () => { assert.equal(room.rounds.length, reset); return `clean-${++reset}`; },
  };
  for (let round = 1; round <= 3; round++) {
    if (round > 1) for (const p of [one, two]) submitStrategy(room, p.token, round, `Round ${round}: compare all rows`, 1000 + round);
    const players = startRoom(room, 'host-only', round, 1000 + round);
    await runPlayRound(round, players, ['half_load'], deps, new AbortController().signal, e => recordRoomEvent(room, e, 2000 + round));
    finishRoomJob(room, false);
    if (round < 3) assert.equal(roomView(room, 0, one.token, 2000 + round).self?.ready, false);
  }
  assert.equal(room.phase, 'finished');
  assert.equal(reset, 3);
  assert.deepEqual(roomView(room, 0, undefined, 3000).standings.map(s => s.points), [105, 105]);
  assert.throws(() => startRoom(room, 'host-only', 3, 3000));
});

test('failed rounds void provisional awards and require fresh coaching; recovery cannot start', () => {
  const { room, one } = lobby();
  startRoom(room, 'host-only', 1, 1000);
  recordRoomEvent(room, { type: 'award', playerId: one.id, amount: 20, reason: 'catch' }, 1100);
  recordRoomEvent(room, { type: 'error', message: 'Round void' }, 1200);
  finishRoomJob(room, true);
  assert.equal(room.phase, 'recovery');
  assert.equal(canStartRoom(room, 1200), false);
  assert.deepEqual(roomView(room, 0, undefined, 1200).standings.map(s => s.points), [0, 0]);
  finishRoomJob(room, false);
  assert.equal(room.phase, 'coaching');
  assert.equal(one.strategyRound, 0);
});


test('Bug Quest publishes the chosen animal and bio without publishing private character fields', () => {
  const room = createRoom('BUG234', 'host-only', 2, 1000);
  joinRoom(room, 'Pip', 'pip-token', 1000, { animal: 'hedgehog', traits: ['curious'], privateCharacter: 'A private goal nobody should read.', publicBio: 'I check the small details.' });
  const view = roomView(room, 0, undefined, 1000);
  assert.equal(view.players[0].animal, 'hedgehog');
  assert.equal(view.players[0].publicBio, 'I check the small details.');
  assert.ok(!JSON.stringify(view).includes('private goal'));
});


test('session animals are unique for defaults and explicitly chosen characters', () => {
  const room = createRoom('UNIQUE', 'host', 4, 1000);
  const profile = { animal: 'fox', traits: ['curious'], privateCharacter: 'A private aim.', publicBio: 'I follow rows.' };
  const first = joinRoom(room, 'Winter', 'one', 1000, profile);
  assert.throws(() => joinRoom(room, 'Moss', 'two', 1000, profile), /already taken/);
  assert.equal(room.players.length, 1);
  const second = joinRoom(room, 'Moss', 'two', 1000);
  assert.notEqual(first.animal, second.animal);
  assert.equal(new Set(roomView(room, 0, undefined, 1000).players.map(p => p.animal)).size, 2);
});
