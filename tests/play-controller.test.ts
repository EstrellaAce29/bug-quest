import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controllerOptions, terminalText, playerEventText } from '../scripts/player.mjs';

test('terminal controller accepts local game connections and rejects remote or credential URLs', () => {
  const options = controllerOptions(['--code', 'ABCD23', '--name', 'Moss']);
  assert.ok('url' in options);
  assert.equal(options.url, 'http://127.0.0.1:3000');
  for (const url of ['https://example.com', 'http://localhost:8080', 'http://user:secret@localhost:3000', 'http://localhost:3000/path']) assert.throws(() => controllerOptions(['--url', url]));
  assert.throws(() => controllerOptions(['--name']));
});

test('terminal results show awards and findings while stripping terminal control sequences', () => {
  assert.equal(terminalText('\u001b[2Jbad\u0000'), '[2Jbad');
  const event = (amount: number, reason: string) => ({ event: { type: 'award', playerId: 'player-1', amount, reason } });
  assert.equal(playerEventText(event(20, 'catch'), 'player-1'), '+20 · bug caught');
  assert.equal(playerEventText(event(15, 'fix'), 'player-1'), '+15 · verified fix');
  assert.equal(playerEventText(event(-5, 'false_alarm'), 'player-1'), '-5 · false alarm');
  assert.equal(playerEventText(event(20, 'catch'), 'player-2'), null);
  assert.match(playerEventText({ event: { type: 'finding', playerId: 'player-1', finding: { reportedBug: true, summary: 'Rows missing' } } }, 'player-1'), /FLAGGED.*Rows missing/);
});
