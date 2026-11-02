import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, chmod, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ANIMALS, parseAnimal, parseTraits, validateCharacter, characterPolicy, containsPrivateEcho } from '../lib/play-character.mjs';
import { traitChart, characterFile, characterWizard, saveCharacter, loadCharacter } from '../scripts/play-character.mjs';
import { expandCharacterStrategy, generateCharacterSpeech } from '../lib/play-personality';
import { createRoom, joinRoom, roomView, submitStrategy, startRoom, recordRoomEvent } from '../lib/play-room';
import { runPlayRound, type PlayDependencies } from '../lib/play';

const privateText = 'My hidden compass points toward copper moons and I speak in clipped little questions.';
const character = { animal: 'fox' as const, traits: ['duplicate-hunter', 'speedrunner'], privateCharacter: privateText, publicBio: 'I follow suspicious rows. Ask me what the counts are hiding.' };
const signal = new AbortController().signal;
const env = { NODE_ENV: 'test', OPENAI_API_KEY: 'fixture-key', OPENAI_MODEL: 'test-model' } as NodeJS.ProcessEnv;
const checks = [
  { title: 'Run', objective: 'Verify all tasks succeeded', invariant: 'tasks', expectsBug: false },
  { title: 'Rows', objective: 'Verify extract and load each contain 2986 matches', invariant: 'rows', expectsBug: false },
  { title: 'Duplicates', objective: 'Verify no duplicate full match payloads', invariant: 'duplicates', expectsBug: false },
];
function model(output: unknown, capture?: (value: Record<string, any>) => void) {
  return { env, fetch: async (_url: unknown, init?: RequestInit) => {
    capture?.(JSON.parse(String(init?.body)));
    return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(output) }] }] });
  } };
}

test('trait chart has the 3×3 personality grid and numbered focus traits; mixed own words and duplicate selections are preserved honestly', () => {
  const chart = traitChart();
  for (const name of ['Careful', 'Balanced', 'Bold', 'Data', 'Systems']) assert.ok(chart.includes(name));
  for (let n = 1; n <= 15; n++) assert.match(chart, new RegExp(`\\b${n} `));
  assert.deepEqual(parseTraits('1, 11, 9, asks twice, THOROUGH, 11'), ['thorough', 'duplicate-hunter', 'speedrunner', 'asks twice']);
  for (const input of ['', '0', '19', '1, \u001b[2J']) assert.throws(() => parseTraits(input));
  assert.deepEqual(characterPolicy({ ...character, traits: ['constructor', '__proto__'] }).preferredInvariants, []);
  assert.equal(characterPolicy(character).maxChecks, 1);
  assert.equal(characterPolicy({ ...character, traits: ['thorough'] }).maxChecks, 3);
});

test('character validation bounds fields, limits the public bio to three sentences, and strips unexpected keys', () => {
  const safe = validateCharacter({ ...character, privateToken: 'not-a-public-field' });
  assert.deepEqual(Object.keys(safe).sort(), ['animal', 'privateCharacter', 'publicBio', 'traits']);
  assert.throws(() => validateCharacter({ ...character, publicBio: 'One. Two. Three. Four.' }));
  assert.throws(() => validateCharacter({ ...character, privateCharacter: '' }));
  assert.throws(() => validateCharacter({ ...character, traits: ['bad\u001b'] }));
});

test('wizard asks five steps, echoes only traits, saves private profiles securely, and reuses them without retyping', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'play-character-'));
  try {
    const answers = ['Winter', '3', '1, 11, 9, asks twice', privateText, character.publicBio];
    const output: string[] = [], green: string[] = [];
    const profile = await characterWizard({ directory, ask: async (label: string) => { output.push(label); return answers.shift()!; }, print: (value: string) => output.push(value), green: (value: string) => green.push(value) });
    for (let step = 1; step <= 5; step++) assert.ok(output.some(line => line.includes(`Step ${step}/5`)));
    assert.equal(profile.animal, 'fox');
    assert.equal(profile.privateCharacter, privateText);
    assert.ok(!output.join('\n').includes(privateText));
    assert.equal(green[0], 'Chosen animal: fox');
    assert.match(green.find(line => line.startsWith('Chosen traits:'))!, /thorough, duplicate-hunter, speedrunner, asks twice/);
    assert.equal((await stat(characterFile('Winter', directory))).mode & 0o777, 0o600);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    const reused = await characterWizard({ directory, options: { character: 'Winter' }, ask: async () => { throw new Error('Unexpected prompt'); }, print: () => {}, green: () => {} });
    assert.deepEqual(reused, profile);
    await chmod(characterFile('Winter', directory), 0o644);
    await saveCharacter(profile, directory);
    assert.equal((await stat(characterFile('Winter', directory))).mode & 0o777, 0o600);
    assert.equal((await loadCharacter('winter', directory))?.name, 'Winter');
    assert.ok((await readFile(characterFile('Winter', directory), 'utf8')).includes(privateText));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('room snapshots publish the bio and join announcement, never traits, private descriptions or credentials', () => {
  const room = createRoom('ABCD23', 'host-secret', 2, 1000);
  const winter = joinRoom(room, 'Winter', 'winter-token', 1000, character);
  const blaze = joinRoom(room, 'Blaze', 'blaze-token', 1000, { ...character, publicBio: 'I watch the totals.' });
  recordRoomEvent(room, { type: 'joined', playerId: blaze.id, name: blaze.name, publicBio: blaze.character!.publicBio }, 1100);
  for (const view of [roomView(room, 0, undefined, 1200), roomView(room, 0, winter.token, 1200)]) {
    const text = JSON.stringify(view);
    assert.ok(text.includes(character.publicBio));
    for (const secret of [privateText, 'duplicate-hunter', 'host-secret', 'winter-token', 'blaze-token', 'privateCharacter']) assert.ok(!text.includes(secret));
    assert.ok(view.events.some(e => e.event.type === 'joined' && e.event.name === 'Blaze'));
  }
  submitStrategy(room, winter.token, 1, 'Inspect the data', 1200);
  submitStrategy(room, blaze.token, 1, 'Inspect the data', 1200);
  assert.equal(startRoom(room, 'host-secret', 1, 1200)[0].character?.privateCharacter, privateText);
});

test('duplicate focus and speedrunner affect actual published plans; private fields stay in model input', async () => {
  let sent: Record<string, any> = {};
  const result = await expandCharacterStrategy('Inspect data integrity', { runId: 'play_run', extractedRows: 2986 }, signal, character, model({ checks }, value => { sent = value; }));
  assert.equal(result.length, 1);
  assert.equal(result[0].invariant, 'duplicates');
  assert.equal(JSON.parse(sent.input).character.privateCharacter, privateText);
  assert.equal(sent.text.format.schema.properties.checks.maxItems, 1);
  assert.ok(!JSON.stringify(result).includes(privateText));
  const fast = await expandCharacterStrategy('Inspect integrity', { runId: 'play_run', extractedRows: 2986 }, signal, { ...character, traits: ['speedrunner'] }, model({ checks }));
  assert.equal(fast[0].invariant, 'rows');
  const narrow = await expandCharacterStrategy('Compare only row counts', { runId: 'play_run', extractedRows: 2986 }, signal, character, model({ checks: [checks[1]] }));
  assert.equal(narrow[0].invariant, 'rows');
});

test('model output cannot expose private character passages or smuggle extra fields into public checks', async () => {
  await assert.rejects(expandCharacterStrategy('Inspect', { runId: 'play_run', extractedRows: 2986 }, signal, character, model({ checks: [{ ...checks[0], objective: privateText }] })), error => error instanceof Error && !error.message.includes(privateText));
  const result = await expandCharacterStrategy('Inspect rows', { runId: 'play_run', extractedRows: 2986 }, signal, undefined, model({ checks: [{ ...checks[1], privateCharacter: privateText }] }));
  assert.ok(!JSON.stringify(result).includes(privateText));
  assert.equal(containsPrivateEcho('My hidden compass points toward copper moons', privateText), true);
});

test('speech uses private voice guidance but publishes a short validated line, with safe cosmetic fallbacks', async () => {
  assert.equal(await generateCharacterSpeech(character, 'catch', signal, model({ line: 'Count first. Celebrate later.' })), 'Count first. Celebrate later.');
  for (const line of [privateText, '<script>bad</script>', 'https://bad.example', 'x'.repeat(101)]) {
    const safe = await generateCharacterSpeech(character, 'catch', signal, model({ line }));
    assert.equal(safe, 'That check found something worth fixing.');
    assert.ok(!safe.includes(privateText));
  }
  const safe = await generateCharacterSpeech(character, 'miss', signal, { env, fetch: async () => { throw new Error(privateText); } });
  assert.ok(!safe.includes(privateText));
});

test('character-aware expansion and speech preserve points and cleanup, even when speech generation fails', async () => {
  const player = { id: 'player-1', name: 'Winter', strategy: 'Inspect rows', character };
  let reset = 0, seen = false;
  const deps: PlayDependencies = {
    prepare: async () => ({ runId: 'play_run', counts: { runId: 'play_run', extractedRows: 2986, matchesLoaded: 1493, totalWins: 1493, otherRunRows: 0 }, duplicates: 0 }),
    expand: async (_strategy, _snapshot, _signal, profile) => { seen = profile?.privateCharacter === privateText; return [checks[1] as any]; },
    inspect: async () => ({ invariant: 'rows', reportedBug: true, summary: 'Rows missing' }),
    repair: async caught => caught,
    speak: async () => { throw new Error(privateText); },
    reset: async () => `clean-${++reset}`,
  };
  const events: unknown[] = [];
  const result = await runPlayRound(1, [player], ['half_load'], deps, signal, e => events.push(e));
  assert.equal(result.scores[0].points, 35);
  assert.equal(seen, true); assert.equal(reset, 1);
  assert.ok(!JSON.stringify(events).includes(privateText));
  deps.speak = async () => privateText;
  const blocked: unknown[] = [];
  await runPlayRound(2, [player], ['half_load'], deps, signal, e => blocked.push(e));
  assert.ok(!JSON.stringify(blocked).includes(privateText));
  assert.equal(reset, 2);
  const spoken: string[] = [];
  deps.speak = async (_player, reason) => { spoken.push(reason); return 'I have another question.'; };
  await runPlayRound(2, [player], ['half_load'], deps, signal, e => events.push(e));
  assert.deepEqual(spoken, ['catch', 'fix']);
  assert.equal(reset, 3);
});


test('animal choices accept exactly the eight offered species; visuals never change personality policy', () => {
  assert.deepEqual(ANIMALS, ['rabbit', 'wolf', 'fox', 'owl', 'bear', 'cat', 'raccoon', 'hedgehog']);
  for (let i = 0; i < ANIMALS.length; i++) {
    assert.equal(parseAnimal(String(i + 1)), ANIMALS[i]);
    assert.equal(parseAnimal(ANIMALS[i].toUpperCase()), ANIMALS[i]);
    assert.equal(validateCharacter({ ...character, animal: ANIMALS[i] }).animal, ANIMALS[i]);
    assert.deepEqual(characterPolicy({ ...character, animal: ANIMALS[i] }), characterPolicy(character));
  }
  for (const choice of ['0', '9', 'dragon', '', '\u001b[2J']) assert.throws(() => parseAnimal(choice));
  assert.throws(() => validateCharacter({ ...character, animal: 'dragon' }));
});

test('saved four-step profiles ask once for an animal and keep private text during migration', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'bugquest-legacy-profile-'));
  try {
    const { animal: _animal, ...old } = character;
    await writeFile(characterFile('Moss', directory), JSON.stringify({ version: 1, name: 'Moss', ...old }), { mode: 0o600 });
    const labels: string[] = [];
    const migrated = await characterWizard({ directory, options: { character: 'Moss' }, ask: async (label: string) => { labels.push(label); return '5'; }, print: () => {}, green: () => {} });
    assert.equal(migrated.animal, 'bear');
    assert.equal(migrated.privateCharacter, privateText);
    assert.equal(labels.length, 1);
    const saved = JSON.parse(await readFile(characterFile('Moss', directory), 'utf8'));
    assert.equal(saved.version, 2);
    assert.equal(saved.animal, 'bear');
    await characterWizard({ directory, options: { character: 'Moss' }, ask: async () => { throw new Error('Migration repeated'); }, print: () => {}, green: () => {} });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
