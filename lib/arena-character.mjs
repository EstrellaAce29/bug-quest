/** @typedef {'rabbit'|'wolf'|'fox'|'owl'|'bear'|'cat'|'raccoon'|'hedgehog'} AnimalKind */
/** @typedef {{animal: AnimalKind, traits: string[], privateCharacter: string, publicBio: string}} ArenaCharacter */
export const TRAIT_GROUPS = [
  { name: 'Careful', traits: ['thorough', 'by-the-book', 'patient'] },
  { name: 'Balanced', traits: ['practical', 'adaptive', 'curious'] },
  { name: 'Bold', traits: ['risk-taker', 'chaos-tester', 'speedrunner'] },
  { name: 'Data', traits: ['row-counter', 'duplicate-hunter', 'null-sniffer'] },
  { name: 'Systems', traits: ['timeout-watcher', 'status-skeptic', 'freshness-checker'] },
];
/** @type {readonly AnimalKind[]} */
export const ANIMALS = Object.freeze(['rabbit', 'wolf', 'fox', 'owl', 'bear', 'cat', 'raccoon', 'hedgehog']);
/** @param {unknown} value @returns {AnimalKind} */
export function parseAnimal(value) {
  if (typeof value !== 'string') throw new Error('Pick an animal from 1 to 8.');
  const answer = value.trim().toLowerCase();
  const animal = /^\d+$/.test(answer) ? ANIMALS[Number(answer) - 1] : ANIMALS.find(item => item === answer);
  if (!animal) throw new Error('Pick 1–8, or type rabbit, wolf, fox, owl, bear, cat, raccoon or hedgehog.');
  return animal;
}
const catalogue = TRAIT_GROUPS.flatMap(group => group.traits);
const controls = /[\x00-\x08\x0b-\x1f\x7f]/;
export function validateAgentName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 60 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('Give your agent a name of 1–60 printable characters.');
  return value.trim();
}
export function parseTraits(input) {
  if (typeof input !== 'string' || input.length > 1600 || controls.test(input)) throw new Error('Use trait numbers or your own words, separated by commas.');
  const selected = [];
  for (const raw of input.split(',')) {
    const value = raw.trim();
    if (!value) continue;
    let trait = value;
    if (/^\d+$/.test(value)) {
      const number = Number(value);
      if (number < 1 || number > catalogue.length) throw new Error('Trait numbers run from 1 to 15.');
      trait = catalogue[number - 1];
    } else trait = catalogue.find(label => label.toLowerCase() === value.toLowerCase()) || value;
    if (trait.length > 60 || /[\x00-\x1f\x7f]/.test(trait)) throw new Error('Keep each trait to 60 printable characters.');
    if (!selected.some(label => label.toLowerCase() === trait.toLowerCase())) selected.push(trait);
  }
  if (!selected.length || selected.length > 24) throw new Error('Pick between 1 and 24 traits.');
  return selected;
}
/** @param {unknown} value @returns {ArenaCharacter} */
export function validateCharacter(value) {
  const data = /** @type {Partial<ArenaCharacter> | null} */ (value);
  if (!data || typeof data !== 'object' || !Array.isArray(data.traits) || !data.traits.length || data.traits.length > 24 || data.traits.some(t => typeof t !== 'string' || !t.trim() || t.includes(',') || t.length > 60 || /[\x00-\x1f\x7f]/.test(t))) throw new Error('Choose valid character traits.');
  const animal = data.animal === undefined ? 'rabbit' : parseAnimal(data.animal);
  const traits = parseTraits(data.traits.join(','));
  if (typeof data.privateCharacter !== 'string' || !data.privateCharacter.trim() || data.privateCharacter.length > 2000 || controls.test(data.privateCharacter)) throw new Error('Write a private character description of 1–2,000 characters.');
  if (typeof data.publicBio !== 'string' || !data.publicBio.trim() || data.publicBio.length > 600 || controls.test(data.publicBio)) throw new Error('Write a public bio of 1–600 characters.');
  const publicBio = data.publicBio.trim().replace(/\s+/g, ' ');
  const sentences = [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(publicBio)].filter(s => s.segment.trim());
  if (sentences.length < 1 || sentences.length > 3) throw new Error('Keep the public bio to 1–3 sentences.');
  return { animal, traits, privateCharacter: data.privateCharacter.trim(), publicBio };
}
/** @param {ArenaCharacter | undefined} character */
export function characterPolicy(character) {
  const labels = character?.traits.map(t => t.toLowerCase()) ?? [];
  const priorities = { 'duplicate-hunter': 'duplicates', 'row-counter': 'rows', 'status-skeptic': 'tasks', 'timeout-watcher': 'tasks', 'freshness-checker': 'tasks', 'null-sniffer': 'rows' };
  const preferredInvariants = [...new Set(labels.flatMap(label => Object.hasOwn(priorities, label) ? [priorities[label]] : []))];
  return { maxChecks: labels.includes('speedrunner') ? 1 : 3, preferredInvariants };
}
/** Prevent raw private passages from being published in model output. */
export function containsPrivateEcho(text, privateCharacter) {
  const words = value => String(value).normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const source = words(privateCharacter); const target = ` ${words(text).join(' ')} `;
  if (!source.length) return false;
  const size = Math.min(4, source.length);
  for (let i = 0; i <= source.length - size; i++) if (target.includes(` ${source.slice(i, i + size).join(' ')} `)) return true;
  return false;
}

/** @param {unknown} text @param {ArenaCharacter | undefined} character */
export function publishableSpeech(text, character) {
  return typeof text === 'string' && !!text.trim() && text.length <= 100 && text.trim().split(/\s+/).length <= 18 &&
    !/[\x00-\x1f\x7f<>`]|https?:\/\//i.test(text) &&
    (!character || !containsPrivateEcho(text, character.privateCharacter));
}
