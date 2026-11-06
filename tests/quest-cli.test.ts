import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { questOptions, runQuest } from '../scripts/quest.mjs';

const answers = (...values: string[]) => async () => {
  assert.ok(values.length, 'Unexpected extra prompt');
  return values.shift()!;
};

test('importing the CLI is inert, and non-interactive invocations cannot launch a quest', () => {
  const imported = spawnSync(process.execPath, ['--input-type=module', '-e', "globalThis.fetch=()=>{throw new Error('Unexpected quest request')}; await import('./scripts/quest.mjs'); console.log('Imported without running');"], { encoding: 'utf8', timeout: 5000 });
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout.trim(), 'Imported without running');
  const invoked = spawnSync(process.execPath, ['scripts/quest.mjs', '--name', 'Winter', '--instruction', 'Verify rows'], { input: '\n\n\n', encoding: 'utf8', timeout: 5000 });
  assert.equal(invoked.status, 1);
  assert.match(invoked.stderr, /interactive terminal.*No quest was started/);
});

test('quest CLI permits interactive input and validates only explicitly supplied prefills', () => {
  assert.deepEqual(questOptions([]), { agent: undefined, instruction: undefined, target: 'airflow' });
  assert.deepEqual(questOptions(['--name', ' Moss ', '--instruction', ' Verify rows ']), { agent: 'Moss', instruction: 'Verify rows', target: 'airflow' });
  for (const args of [['--name', ' '], ['--unknown', 'x'], ['--name', 'x'.repeat(81)], ['--name', 'Moss', '--instruction'], ['--instruction', ' ']]) assert.throws(() => questOptions(args));
});

test('quest CLI waits for name, check and final Enter before making any request', async () => {
  const prompts: string[] = [];
  const pending: ((answer: string) => void)[] = [];
  let requests = 0;
  const run = runQuest([], {
    print: () => {},
    ask: (prompt: string) => { prompts.push(prompt); return new Promise<string>(resolve => pending.push(resolve)); },
    fetcher: async (_url, init) => {
      requests++;
      assert.deepEqual(JSON.parse(init!.body as string), { agent: 'Winter', instruction: 'Verify all rows loaded', target: 'airflow', confirmed: true });
      return new Response('{"type":"done","points":0,"bugsFound":0}\n');
    },
  });
  const nextPrompt = async () => { for (let i = 0; i < 10 && !pending.length; i++) await Promise.resolve(); assert.ok(pending.length); };
  assert.match(prompts[0], /Name your agent/); assert.equal(requests, 0);
  pending.shift()!('Winter'); await nextPrompt();
  assert.match(prompts[1], /What should your agent check/); assert.equal(requests, 0);
  pending.shift()!(''); await nextPrompt();
  assert.match(prompts[2], /What should your agent check/); assert.equal(requests, 0);
  pending.shift()!('Verify all rows loaded'); await nextPrompt();
  assert.match(prompts[3], /Press Enter/); assert.equal(requests, 0);
  pending.shift()!(''); await run; assert.equal(requests, 1);
});

test('CLI prefills never bypass confirmation; cancelling or aborting makes no request', async () => {
  for (const aborting of [false, true]) {
    const controller = new AbortController();
    let prompts = 0;
    const run = runQuest(['--name', 'Winter', '--instruction', 'Verify rows'], {
      print: () => {}, signal: controller.signal,
      ask: async () => { prompts++; if (prompts === 3 && aborting) controller.abort(); return prompts === 3 ? 'cancel' : ''; },
      fetcher: async () => { assert.fail('A cancelled quest must not start'); },
    });
    if (aborting) await assert.rejects(run); else await run;
    assert.equal(prompts, 3);
  }
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
    ask: answers('', 'Verify rows', ''),
    fetcher: async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:3000/api/quest');
      assert.deepEqual(JSON.parse(init!.body as string), { agent: 'Moss', instruction: 'Verify rows', target: 'airflow', confirmed: true });
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
    await assert.rejects(runQuest(['--name', 'Moss'], { print: () => {}, ask: answers('', 'Verify rows', ''), fetcher: async () => response }));
  }
});
