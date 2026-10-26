#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const required = ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'];
if (required.some(name => !process.env[name])) {
  console.error('Configure PGHOST, PGPORT, PGUSER, PGPASSWORD and PGDATABASE in .env.local.');
  process.exit(1);
}
const runId = process.argv.find(arg => arg.startsWith('--run-id='))?.slice(9);
if (runId && !/^[a-zA-Z0-9_.:+-]{1,250}$/.test(runId)) {
  console.error('Invalid Airflow run ID.'); process.exit(1);
}
// Run IDs are bounded and allowlisted above; credentials are passed only through env.
const sql = `
WITH selected AS (
 SELECT run_id, extracted_rows FROM warehouse.run_metadata
 WHERE reported_at IS NOT NULL ${runId ? `AND run_id = '${runId}'` : ''}
 ORDER BY reported_at DESC LIMIT 1
)
SELECT json_build_object(
 'runId', selected.run_id, 'extractedRows', selected.extracted_rows,
 'matchesLoaded', (SELECT COUNT(*) FROM warehouse.matches WHERE run_id = selected.run_id),
 'totalWins', (SELECT COALESCE(SUM(wins), 0) FROM warehouse.player_wins),
 'otherRunRows', (SELECT COUNT(*) FROM warehouse.matches WHERE run_id <> selected.run_id)
) FROM selected;`;
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/KEY|TOKEN|SECRET|AIRFLOW/.test(name)));
const response = spawnSync('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
  env: { ...env, PGCONNECT_TIMEOUT: '5' }, encoding: 'utf8', timeout: 15000,
});
if (response.error || response.status !== 0) {
  console.error('Could not query the Airflow warehouse. Confirm database settings and complete a DAG run first.'); process.exit(1);
}
if (!response.stdout.trim()) { console.error('No completed warehouse run found.'); process.exit(1); }
const result = JSON.parse(response.stdout.trim());
const valid = ['extractedRows', 'matchesLoaded', 'totalWins', 'otherRunRows'].every(key => Number.isSafeInteger(result[key]) && result[key] >= 0);
if (!valid || typeof result.runId !== 'string') { console.error('Invalid warehouse result.'); process.exit(1); }
const rowsMatch = result.extractedRows === result.matchesLoaded && result.otherRunRows === 0;
const winsMatch = result.totalWins === result.matchesLoaded;
if (process.argv.includes('--json')) console.log(JSON.stringify(result));
else {
 console.log(`Run: ${result.runId}`);
 console.log(`Extracted rows (run_metadata): ${result.extractedRows}`);
 console.log(`Rows in warehouse.matches:    ${result.matchesLoaded}`);
 console.log(`Total wins (player_wins):     ${result.totalWins}`);
 console.log(`Extracted vs loaded: ${rowsMatch ? 'PASS' : 'FAIL — silent row loss or stale snapshot'}`);
 console.log(`Total wins vs loaded: ${winsMatch ? 'PASS' : 'FAIL'}`);
}
process.exitCode = rowsMatch && winsMatch ? 0 : 2;
