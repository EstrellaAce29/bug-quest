import 'server-only';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runKane } from './run-kane';
import { expandQuest } from './expand-quest';
import { createFixWorkspace } from './fix-workspace';
import { proposePipelineFix } from './propose-fix';
import { attemptAutoFix } from '../auto-fix';
import { parseWarehouseCounts, warehousePasses, type WarehouseCounts } from '../warehouse-check';
import { applyDagPatch } from '../dag-patch';
import type { LiveResult, FixReport } from '../quest-contract';

const exec = promisify(execFile);
const DAG = 'tennis_tournament_pipeline';
export const REAL_DAG_FILE = 'real-pipeline/dags/tennis_tournament_pipeline.py';
type Check = Pick<LiveResult, 'id' | 'title' | 'objective' | 'kind'>;
type Counts = WarehouseCounts;

function setting(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Configure ${name} in .env.local before running Real Airflow.`);
  return value;
}
export function airflowSettings() {
  const url = new URL(setting('AIRFLOW_URL'));
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('AIRFLOW_URL must be a local Airflow origin without embedded credentials.');
  }
  for (const name of ['AIRFLOW_USERNAME', 'AIRFLOW_PASSWORD', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE']) setting(name);
  return url.origin;
}

export async function warehouseCounts(runId: string | undefined, signal: AbortSignal): Promise<Counts> {
  const args = ['scripts/check_real_pipeline.mjs', '--json', ...(runId ? [`--run-id=${runId}`] : [])];
  let stdout: string;
  try { ({ stdout } = await exec(process.execPath, args, { cwd: process.cwd(), signal, timeout: 20000, maxBuffer: 65536 })); }
  catch (error) {
    const failure = error as { code?: number; stdout?: string };
    if (failure.code !== 2 || !failure.stdout) throw new Error('Warehouse query unavailable. Check .env.local and complete the tennis DAG first.');
    stdout = failure.stdout;
  }
  return parseWarehouseCounts(JSON.parse(stdout.trim()), runId);
}

export async function createRealAirflow(signal: AbortSignal, log: (message: string) => void) {
  const base = airflowSettings();
  let token = '';
  async function api(endpoint: string, method = 'GET', body?: unknown, requestSignal = signal) {
    if (!token) {
      const auth = await fetch(`${base}/auth/token`, { method: 'POST', signal: AbortSignal.any([requestSignal, AbortSignal.timeout(15000)]), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: setting('AIRFLOW_USERNAME'), password: setting('AIRFLOW_PASSWORD') }) });
      if (!auth.ok) throw new Error(`Airflow authentication failed (HTTP ${auth.status}).`);
      token = (await auth.json()).access_token;
      if (!token) throw new Error('Airflow returned no access token.');
    }
    const response = await fetch(`${base}/api/v2${endpoint}`, { method, signal: AbortSignal.any([requestSignal, AbortSignal.timeout(15000)]), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) throw new Error(`Airflow request failed (HTTP ${response.status}).`);
    return response.json();
  }
  // Bind this quest to one completed run; do not compare data from an unrelated DAG run.
  const initial = await warehouseCounts(undefined, signal);
  const expectedRows = initial.extractedRows;
  if (expectedRows < 1) throw new Error('The extracted source must contain at least one match.');
  let runId = initial.runId;
  const runPath = () => `/dags/${DAG}/dagRuns/${encodeURIComponent(runId)}`;
  const existing = await api(runPath());
  if (existing.state !== 'success') throw new Error('Complete the tennis DAG successfully before starting this quest.');
  log(`bound to Airflow run ${runId}; expected ${expectedRows} extracted matches.`);

  async function sqlResult(check: Check, checkSignal: AbortSignal): Promise<LiveResult> {
    const sql = await warehouseCounts(runId, checkSignal);
    const passed = warehousePasses(sql, expectedRows);
    return { ...check, status: passed ? 'passed' : 'failed', resultCode: null, summary: `SQL run ${runId}: extracted ${sql.extractedRows} (expected ${expectedRows}); loaded ${sql.matchesLoaded}; total wins ${sql.totalWins}; other-run rows ${sql.otherRunRows}.`, sql, source: 'sql', confirmedBug: !passed, testUrl: null, credits: 0 };
  }
  async function run(check: Check, checkSignal: AbortSignal, checkLog: (message: string) => void): Promise<LiveResult> {
    if (check.kind === 'row_conservation') return sqlResult(check, checkSignal);
    // Keep credentials out of objectives, subprocess env and the browser response. Login in Kane's visible browser once.
    const objective = check.kind === 'basic' ? check.objective : `Open Airflow. Verify DAG ${DAG} run ${runId} is success and all six tasks extract, validate, transform, load, standings, report are success.`;
    const directory = await mkdtemp(path.join(tmpdir(), 'bugquest-airflow-'));
    let result: LiveResult;
    try {
      const variables = path.join(directory, 'variables.json');
      await writeFile(variables, JSON.stringify({
        airflow_user: { value: setting('AIRFLOW_USERNAME'), secret: true },
        airflow_password: { value: setting('AIRFLOW_PASSWORD'), secret: true },
      }), { mode: 0o600 });
      const runUrl = `${base}/dags/${DAG}/runs/${encodeURIComponent(runId)}`;
      const login = `If the Airflow login page appears, sign in using {{airflow_user}} and {{airflow_password}}. After sign-in, or if already signed in, navigate to ${runUrl} before doing the following instruction. `;
      result = await runKane({ ...check, objective: login + objective }, checkSignal, checkLog, runUrl, variables);
      result.objective = check.objective;
    } finally { await rm(directory, { recursive: true, force: true }); }
    if (result.status !== 'passed') return { ...result, source: 'kane' };
    const state = await api(runPath());
    const tasks = await api(`${runPath()}/taskInstances?limit=100`);
    const taskList = tasks.task_instances ?? [];
    const healthy = state.state === 'success' && ['extract', 'validate', 'transform', 'load', 'standings', 'report'].every(id => taskList.some((task: {task_id: string; state: string}) => task.task_id === id && task.state === 'success'));
    return { ...result, status: healthy ? 'passed' : 'failed', source: 'kane', confirmedBug: !healthy, summary: `${result.summary} REST cross-check of pinned run: ${healthy ? 'all six tasks success' : 'run/task status mismatch'}.` };
  }
  let appliedAt = 0;
  async function triggerAndWait(checkSignal: AbortSignal) {
    // Serialization timestamps are read from the API; never trigger against the old DAG code.
    const candidate = await readFile(path.join(process.cwd(), REAL_DAG_FILE), 'utf8');
    const deadline = Date.now() + 360000;
    let parsed = false;
    while (Date.now() < deadline) {
      checkSignal.throwIfAborted();
      await delay(3000, undefined, { signal: checkSignal });
      const details = await api(`/dags/${DAG}/details`);
      if (!details.has_import_errors && Date.parse(details.last_parsed_time) > appliedAt) {
        const source = await api(`/dagSources/${DAG}`);
        if (source.content === candidate) { parsed = true; break; }
      }
    }
    if (!parsed) throw new Error('Airflow has not re-parsed the changed DAG.');
    await api(`/dags/${DAG}`, 'PATCH', { is_paused: false });
    runId = `bugquest_${randomUUID()}`;
    await api(`/dags/${DAG}/dagRuns`, 'POST', { dag_run_id: runId, logical_date: new Date().toISOString(), conf: {} });
    log(`triggered Airflow run ${runId}; waiting for all tasks...`);
    const finishBy = Date.now() + 600000;
    while (Date.now() < finishBy) {
      checkSignal.throwIfAborted();
      const state = await api(runPath());
      if (state.state === 'success') return;
      if (state.state === 'failed') throw new Error('Candidate Airflow DAG run failed.');
      await delay(3000, undefined, { signal: checkSignal });
    }
    throw new Error('Timed out waiting for Airflow run; human review required.');
  }
  return {
    expand: (instruction: string, checkSignal: AbortSignal) => expandQuest(instruction, checkSignal, { runId, extractedRows: expectedRows }),
    run,
    repair: (failure: LiveResult, basic: Check, checkSignal: AbortSignal, checkLog: (message: string) => void, update: (report: FixReport) => void) => {
      let candidateVerified = false;
      const workspace = createFixWorkspace(process.cwd(), { file: REAL_DAG_FILE, patch: applyDagPatch, validate: async validationSignal => {
        await readFile(path.join(process.cwd(), REAL_DAG_FILE), 'utf8');
        const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV };
        try { await exec('python3', ['-c', 'import ast,pathlib,sys; ast.parse(pathlib.Path(sys.argv[1]).read_text())', path.join(process.cwd(), REAL_DAG_FILE)], { env, signal: validationSignal, timeout: 15000 }); }
        catch { throw new Error('Candidate DAG failed Python syntax validation.'); }
        await triggerAndWait(validationSignal);
      } });
      return attemptAutoFix(failure, basic, {
        ...workspace,
        apply: async (checkpoint, proposal) => {
          candidateVerified = false;
          appliedAt = Date.now();
          return workspace.apply(checkpoint, proposal);
        },
        restore: async checkpoint => {
          // Always restore the file, even if stopping an active run hits a network error.
          let stopFailed = false;
          try {
            if (runId.startsWith('bugquest_')) {
              const cleanupSignal = AbortSignal.timeout(20000);
              const current = await api(runPath(), 'GET', undefined, cleanupSignal);
              if (['queued', 'running'].includes(current.state)) await api(runPath(), 'PATCH', { state: 'failed' }, cleanupSignal);
            }
          } catch { stopFailed = true; }
          await workspace.restore(checkpoint);
          if (stopFailed) throw new Error('Source restored, but the Airflow attempt could not be confirmed stopped.');
        },
        propose: (input, proposeSignal) => proposePipelineFix(input, proposeSignal, 'airflow'),
        run: async (check, runSignal, runLog) => {
          const sql = await sqlResult(check, runSignal);
          const browser = await run(check.kind === 'basic' ? check : { ...check, kind: 'task_status' }, runSignal, runLog);
          const passed = sql.status === 'passed' && browser.status === 'passed';
          candidateVerified = passed;
          return { ...browser, ...check, source: 'kane+sql', sql: sql.sql, status: passed ? 'passed' : browser.status === 'error' ? 'error' : 'failed', confirmedBug: !passed && browser.status !== 'error', summary: `${browser.summary} ${sql.summary}` };
        },
        commit: async (checkpoint, description) => {
          if (!candidateVerified) throw new Error('Kane and SQL must pass before commit.');
          return workspace.commit(checkpoint, description);
        },
      }, checkSignal, checkLog, update);
    },
  };
}
