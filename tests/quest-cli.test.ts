import { test } from 'node:test';
import assert from 'node:assert/strict';
import { questOptions, runQuest } from '../scripts/quest.mjs';

test('quest CLI validates arguments and uses the browser default target', () => {
  assert.deepEqual(questOptions(['--name', ' Moss ', '--instruction', '  ']), { agent: 'Moss', instruction: undefined, target: 'airflow' });
  for (const args of [[], ['--name', ' '], ['--unknown', 'x'], ['--name', 'x'.repeat(81)], ['--name', 'Moss', '--instruction']]) assert.throws(() => questOptions(args));
});

test('quest CLI consumes split UTF-8 NDJSON and prints logs, evidence and scores', async () => {
  const events = [
    { type: 'log', message: 'Moss: checking 🐻\u001b[31m' },
    { type: 'result', result: { title: 'Rows', status: 'failed', summary: 'Missing rows', testUrl: 'https://example.com/evidence' } },
    { type: 'done', points: 35, bugsFound: 1, fixesVerified: 1 },
  ];
  const bytes = new TextEncoder().encode(events.map(e => JSON.stringify(e)).join('\n'));
  const output: string[] = [];
  await runQuest(['--name', 'Moss'], {
    print: (text: string) => output.push(text),
    fetcher: async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:3000/api/quest');
      assert.deepEqual(JSON.parse(init!.body as string), { agent: 'Moss', target: 'airflow' });
      return new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }));
    },
  });
  assert.ok(output.some(s => s.includes('checking 🐻')));
  assert.ok(output.every(s => !s.includes('\u001b')));
  assert.ok(output.some(s => s.includes('Evidence: https://example.com/evidence')));
  assert.ok(output.at(-1)?.includes('35 points · 1 bugs · 1 verified fixes'));
});

test('quest CLI fails on rejected requests, server errors and truncated streams', async () => {
  for (const response of [Response.json({ error: 'Another live quest is running.' }, { status: 409 }), new Response('{"type":"error","message":"Check failed"}\n'), new Response('{"type":"log","message":"Checking"}\n')]) {
    await assert.rejects(runQuest(['--name', 'Moss'], { print: () => {}, fetcher: async () => response }));
  }
});
