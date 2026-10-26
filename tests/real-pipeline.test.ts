import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyDagPatch } from '../lib/dag-patch';
import { parseWarehouseCounts, warehousePasses } from '../lib/warehouse-check';
import { kaneArguments } from '../lib/quest-engine';

const currentSource = readFileSync('real-pipeline/dags/tennis_tournament_pipeline.py', 'utf8');
const oldText = '        matches_to_load = matches[:len(matches) // 2]';
const newText = '        matches_to_load = matches';
const source = currentSource.includes(oldText) ? currentSource : currentSource.replace(newText, oldText);
const proposal = { description: 'load the full extracted match batch', edits: [{ oldText, newText }] };

test('real DAG repair changes only the faulty batch limit, preserving metadata and the six tasks', () => {
  const patch = applyDagPatch(source, proposal);
  assert.equal(patch.source.replace(newText, oldText), source);
  assert.deepEqual(patch.diff.filter(line => line.kind !== 'context').map(line => line.text), [oldText, newText]);
  assert.ok(patch.source.includes('# PLANTED BUG'));
});

test('DAG repair refuses extra changes, calls, changed indentation, and unrelated code', () => {
  for (const edit of [
    { oldText, newText: newText + '\n        print("fake pass")' },
    { oldText, newText: '        matches_to_load = list(matches)' },
    { oldText, newText: 'matches_to_load = matches' },
    { oldText: 'len(rows)', newText: '500' },
    { oldText: source, newText: source.replace(oldText, newText) },
  ]) assert.throws(() => applyDagPatch(source, { ...proposal, edits: [edit] }));
  assert.throws(() => applyDagPatch(source, { ...proposal, edits: [proposal.edits[0], proposal.edits[0]] }));
});

test('SQL catches a silent half-load despite matching wins and refuses fabricated or stale counts', () => {
  const full = { runId: 'bugquest_run-1', extractedRows: 2986, matchesLoaded: 2986, totalWins: 2986, otherRunRows: 0 };
  assert.equal(warehousePasses(full, 2986), true);
  assert.equal(warehousePasses({ ...full, matchesLoaded: 1493, totalWins: 1493 }, 2986), false);
  assert.equal(warehousePasses({ ...full, extractedRows: 1493, matchesLoaded: 1493, totalWins: 1493 }, 2986), false);
  assert.equal(warehousePasses({ ...full, totalWins: 1493 }, 2986), false);
  assert.equal(warehousePasses({ ...full, otherRunRows: 1 }, 2986), false);
  assert.throws(() => parseWarehouseCounts(full, 'another-run'));
  assert.throws(() => parseWarehouseCounts({ ...full, extractedRows: '2986' }));
  assert.throws(() => parseWarehouseCounts({ ...full, runId: "unsafe'run" }));
});

test('real Airflow Kane target does not alter the simulated default or execution limits', () => {
  assert.deepEqual(kaneArguments('Verify the DAG succeeded', 'http://localhost:8081'), [
    'run', 'Verify the DAG succeeded', '--url', 'http://localhost:8081', '--agent', '--max-steps', '15',
  ]);
  assert.equal(kaneArguments('Check the pipeline ran')[3], 'http://localhost:3000/pipelines');
});
