import { parse } from '@babel/parser';
import type { CodeDiffLine, FixProposal } from './quest-contract';

export function codeDiff(before: string, after: string): CodeDiffLine[] {
  const a = before.split('\n'), b = after.split('\n');
  const lengths = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
  const lines: CodeDiffLine[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { lines.push({ kind: 'context', text: a[i++] }); j++; }
    else if (i < a.length && (j === b.length || lengths[i + 1][j] >= lengths[i][j + 1])) lines.push({ kind: 'removed', text: a[i++] });
    else lines.push({ kind: 'added', text: b[j++] });
  }
  const changed = lines.flatMap((line, index) => line.kind === 'context' ? [] : [index]);
  return lines.filter((_, index) => changed.some(at => Math.abs(at - index) <= 2));
}

export function applyPipelinePatch(source: string, proposal: FixProposal): { source: string; diff: CodeDiffLine[] } {
  if (!proposal || typeof proposal.description !== 'string' || !proposal.description.trim() || proposal.description.length > 100 || !Array.isArray(proposal.edits) || proposal.edits.length < 1 || proposal.edits.length > 3) throw new Error('Invalid minimal fix proposal.');
  let candidate = source;
  for (const edit of proposal.edits) {
    if (typeof edit.oldText !== 'string' || !edit.oldText || typeof edit.newText !== 'string' || edit.oldText.length > 1600 || edit.newText.length > 1600 || candidate.split(edit.oldText).length !== 2) throw new Error('Fix must replace one unambiguous existing code fragment.');
    if (/\b(?:import|export)\b/.test(edit.oldText + edit.newText)) throw new Error('Fix cannot change module declarations.');
    candidate = candidate.replace(edit.oldText, () => edit.newText);
  }
  if (candidate === source || candidate.length > source.length + 2000) throw new Error('Fix must make a bounded code change.');
  const diff = codeDiff(source, candidate);
  if (diff.filter(line => line.kind !== 'context').length > 24) throw new Error('Fix is too large for automatic application.');
  let original: unknown, updated: unknown;
  try {
    original = parse(source, { sourceType: 'module', plugins: ['typescript'] });
    updated = parse(candidate, { sourceType: 'module', plugins: ['typescript'] });
  } catch { throw new Error('Fix is not valid TypeScript.'); }
  const allowedCalls = new Set<string>();
  function fragment(node: unknown, text: string) {
    const value = node as { start?: number; end?: number } | null;
    return value && typeof value.start === 'number' && typeof value.end === 'number' ? text.slice(value.start, value.end) : '';
  }
  function walk(node: unknown, visit: (value: Record<string, unknown>) => void) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(item => walk(item, visit)); return; }
    const value = node as Record<string, unknown>;
    if (typeof value.type === 'string') visit(value);
    Object.values(value).forEach(child => walk(child, visit));
  }
  walk(original, node => {
    if (node.type === 'CallExpression' || node.type === 'NewExpression') allowedCalls.add(fragment(node.callee, source));
  });
  const forbidden = new Set(['process', 'globalThis', 'global', 'require', 'eval', 'Function', 'fetch', 'console', 'window', 'document', '__dirname', '__filename', 'constructor', 'prototype', '__proto__']);
  walk(updated, node => {
    const name = node.type === 'Identifier' ? node.name : node.type === 'StringLiteral' ? node.value : null;
    if (typeof name === 'string' && forbidden.has(name)) throw new Error('Fix contains a disallowed system or dynamic-code reference.');
    if ((node.type === 'CallExpression' || node.type === 'NewExpression') && !allowedCalls.has(fragment(node.callee, candidate))) throw new Error('Fix introduces a new function call outside pipeline logic.');
    if (['ImportDeclaration', 'TSImportEqualsDeclaration', 'TaggedTemplateExpression'].includes(String(node.type))) throw new Error('Fix cannot introduce imports or executable templates.');
    if (['AssignmentExpression', 'UpdateExpression'].includes(String(node.type)) && /^bugs(?:\.|\[|$)/.test(fragment(node.left ?? node.argument, candidate))) throw new Error('Fix must not change bug-switch values.');
  });
  return { source: candidate, diff };
}
