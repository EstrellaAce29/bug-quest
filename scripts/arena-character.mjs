import { readFile, writeFile, mkdir, chmod, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { ANIMALS, parseAnimal, TRAIT_GROUPS, parseTraits, validateAgentName, validateCharacter } from '../lib/arena-character.mjs';

export function traitChart() {
  const lines = [];
  for (let block = 0; block < 2; block++) {
    const groups = TRAIT_GROUPS.slice(block * 3, block * 3 + 3);
    lines.push(groups.map(group => group.name.padEnd(24)).join(' | '));
    lines.push(groups.map(() => '─'.repeat(24)).join('─┼─'));
    for (let row = 0; row < 3; row++) lines.push(groups.map((group, col) => `${block * 9 + col * 3 + row + 1} ${group.traits[row]}`.padEnd(24)).join(' | '));
    lines.push('');
  }
  return lines.join('\n');
}
export function characterFile(name, directory = path.join('.arena', 'characters')) {
  return path.join(directory, `${createHash('sha256').update(validateAgentName(name).toLowerCase()).digest('hex')}.json`);
}
export async function loadCharacter(name, directory) {
  let text;
  try { text = await readFile(characterFile(name, directory), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error('Could not read your saved character.'); }
  try {
    if (text.length > 16000) throw new Error();
    const saved = JSON.parse(text);
    const checkedName = validateAgentName(saved.name);
    if (![1, 2].includes(saved.version) || checkedName.toLowerCase() !== name.trim().toLowerCase()) throw new Error();
    if (saved.version === 2 && saved.animal === undefined) throw new Error();
    return { name: checkedName, ...validateCharacter(saved), ...(saved.animal === undefined ? { needsAnimal: true } : {}) };
  } catch { throw new Error('That saved character is not valid. Use --new to write a fresh profile.'); }
}
export async function saveCharacter(profile, directory = path.join('.arena', 'characters')) {
  const name = validateAgentName(profile.name);
  const character = validateCharacter(profile);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const file = characterFile(name, directory); const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ version: 2, name, ...character }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temporary, file);
  } finally { await unlink(temporary).catch(() => {}); }
  return { name, ...character };
}
export function animalMenu() {
  return [ANIMALS.slice(0, 4), ANIMALS.slice(4)].map((row, index) => row.map((animal, col) => `${index * 4 + col + 1} ${animal}`.padEnd(18)).join('')).join('\n');
}
export async function characterWizard({ ask, print, green, options = {}, directory = path.join('.arena', 'characters') }) {
  const retry = async (label, validate) => {
    while (true) {
      const answer = await ask(label);
      try { return validate(answer); } catch (error) { print(error.message); }
    }
  };
  const pickAnimal = async () => {
    print('\nStep 2/5 – Pick an animal'); print(animalMenu());
    const animal = await retry('Your animal (1–8): ', parseAnimal);
    green(`Chosen animal: ${animal}`); return animal;
  };
  const reuse = async saved => {
    let profile = saved;
    if (saved.needsAnimal) {
      print('Your saved character needs an animal. The rest of it stays yours.');
      const animal = await pickAnimal();
      profile = await saveCharacter({ ...saved, animal }, directory);
    }
    print(`Using your saved character: ${profile.name}`);
    if (!saved.needsAnimal) green(`Chosen animal: ${profile.animal}`);
    green(`Chosen traits: ${profile.traits.join(', ')}`);
    print('Your private description stays off the shared screen.'); return profile;
  };
  if (options.character) {
    const saved = await loadCharacter(options.character, directory);
    if (!saved) throw new Error('No saved character has that name. Run without --character to create one.');
    return reuse(saved);
  }
  print('\nStep 1/5 – Name');
  const name = options.name ? validateAgentName(options.name) : await retry('Agent name (Winter, Blaze, Moss, or your own): ', validateAgentName);
  if (options.name) print(name);
  if (!options.new) {
    const saved = await loadCharacter(name, directory);
    if (saved && !['n', 'no'].includes((await ask(`Use ${saved.name}'s saved character? [Y/n] `)).toLowerCase())) return reuse(saved);
  }
  const animal = await pickAnimal();
  print('\nStep 3/5 – Traits'); print(traitChart()); print('Traits guide your checks. A speedrunner takes one check per turn.');
  const traits = await retry('Pick numbers and/or your own words, comma-separated: ', parseTraits);
  green(`Chosen traits: ${traits.join(', ')}`);
  print('\nStep 4/5 – Private character');
  print('How does your agent really play? What does it want? Give it a quirk, a voice, or something that sets it off.');
  print('Saved privately. Used by the server-side model, never shown as a character description on the shared screen.');
  const privateCharacter = await retry('Private character: ', value => {
    if (!value.trim() || value.length > 2000 || /[\x00-\x08\x0b-\x1f\x7f]/.test(value)) throw new Error('Write 1–2,000 printable characters.'); return value.trim();
  });
  print('\nStep 5/5 – Public bio'); print('Write 1–3 sentences. Everyone in Bug Quest will see this when you join.');
  const character = await retry('Public bio: ', publicBio => validateCharacter({ animal, traits, privateCharacter, publicBio }));
  const saved = await saveCharacter({ name, ...character }, directory);
  print(`Saved ${name} locally. Use --character with this name to reuse it.`);
  return saved;
}
