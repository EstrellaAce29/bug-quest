import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

// Only this app's runs from the current Codex conversation. Never copy raw session files.
const sessions = [
  'bcea8f48-0976-4e13-b98c-9bef6435ca03',
  '95f4f143-90ed-4d69-a1fd-b700486884ce',
  '810ac68c-e9ec-4041-8ae2-bf721e861122',
  '36c49d3d-c0f1-462c-8f07-76763afdeec4',
  '18679f06-4e3a-427f-829e-1989e4e1f1a2',
  '25cb1fac-b873-4d4b-b671-7faf7a0bd7bd',
  'fe229984-981f-4ed6-a670-f5f5a75b3620',
];
const afterFixSession = 'fe229984-981f-4ed6-a670-f5f5a75b3620';
const runs = [];
for (const sessionId of sessions) {
  const file = path.join(homedir(), '.testmuai/kaneai/sessions', sessionId, 'events.ndjson');
  const events = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const result = events.findLast(event => event.type === 'run_end');
  if (!result) continue; // Running or aborted commands have no completed result.
  const assertions = Object.entries(result.context?.memory ?? {})
    .filter(([, check]) => check.expected_value !== undefined && check.expected_value !== '')
    .map(([id, check]) => ({ id, description: check.human_description, condition: check.condition }));
  runs.push({
    sessionId, status: result.status, resultCode: result.result_code,
    summary: result.summary, creditsUsed: result.credits_consumed ?? null,
    completedAt: result.ts, url: result.test_url, assertions,
    confirmedBug: result.verdict?.confirmed === true && result.verdict?.family === 'application_issue',
    verifiedFix: sessionId === afterFixSession && result.status === 'passed',
  });
}
const snapshot = {
  capturedAt: new Date().toISOString(),
  totals: {
    kaneRuns: runs.length,
    checksGenerated: runs.reduce((sum, run) => sum + run.assertions.length, 0),
    bugsFound: new Set(runs.filter(run => run.confirmedBug).map(() => 'pipeline-row-mismatch')).size,
    fixesVerified: runs.filter(run => run.verifiedFix).length,
    creditsUsed: runs.every(run => run.creditsUsed !== null) ? runs.reduce((sum, run) => sum + run.creditsUsed, 0) : null,
  },
  runs,
};
await writeFile('data/quest-session.json', JSON.stringify(snapshot, null, 2) + '\n');
console.log(JSON.stringify(snapshot.totals));
