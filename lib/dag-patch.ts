import { codeDiff } from './pipeline-patch';
import type { FixProposal } from './quest-contract';

export function applyDagPatch(source: string, proposal: FixProposal) {
  // Deliberately narrower than an arbitrary Python editor: repair only this batch limit.
  if (!proposal || typeof proposal.description !== 'string' || !proposal.description.trim() || proposal.description.length > 100 || proposal.edits?.length !== 1) throw new Error('Expected one minimal DAG edit.');
  const edit = proposal.edits[0];
  if (typeof edit.oldText !== 'string' || typeof edit.newText !== 'string' || source.split(edit.oldText).length !== 2 ||
      !/^\s*matches_to_load = matches\[:len\(matches\) \/\/ 2\]\s*$/.test(edit.oldText) ||
      !/^\s*matches_to_load = matches\s*$/.test(edit.newText) ||
      edit.oldText.match(/^ */)?.[0] !== edit.newText.match(/^ */)?.[0]) throw new Error('DAG fix may only remove the load batch truncation.');
  const candidate = source.replace(edit.oldText, () => edit.newText);
  return { source: candidate, diff: codeDiff(source, candidate) };
}
