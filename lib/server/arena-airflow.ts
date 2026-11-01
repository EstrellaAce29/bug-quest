import 'server-only';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { airflowSettings, createRealAirflow, warehouseCounts, REAL_DAG_FILE } from './real-airflow';
import { expandArenaStrategy } from './expand-quest';
import { generateCharacterSpeech } from '../arena-personality';
import { detectedBugs, type ArenaBug, type ArenaDependencies, type ArenaSnapshot, type ArenaCheck, type ArenaFinding } from '../arena';

const exec = promisify(execFile);
const DAG = '/dags/tennis_tournament_pipeline';
const recoveryFile = '.arena-recovery.json';
class AirflowHttpError extends Error { constructor(readonly status: number) { super(`Airflow request failed (HTTP ${status}).`); } }

export async function hasArenaRecovery() {
  try { await readFile(recoveryFile); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

export function arenaAirflow(log: (message: string) => void): ArenaDependencies {
  const base = airflowSettings();
  let token = '';
  let activeRun: string | undefined;
  async function api(endpoint: string, signal: AbortSignal, method = 'GET', body?: unknown) {
    if (!token) {
      const auth = await fetch(`${base}/auth/token`, {
        method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: process.env.AIRFLOW_USERNAME, password: process.env.AIRFLOW_PASSWORD }),
      });
      if (!auth.ok) throw new Error(`Airflow authentication failed (HTTP ${auth.status}).`);
      token = (await auth.json()).access_token;
      if (!token) throw new Error('Airflow returned no token.');
    }
    const response = await fetch(`${base}/api/v2${endpoint}`, {
      method, signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new AirflowHttpError(response.status);
    return response.json();
  }
  async function wait(runId: string, signal: AbortSignal, allowFailed = false) {
    const deadline = Date.now() + 600000;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      const run = await api(`${DAG}/dagRuns/${encodeURIComponent(runId)}`, signal);
      if (run.state === 'success') return;
      if (run.state === 'failed') {
        if (!allowFailed) throw new Error('Arena DAG failed; this is an infrastructure error, not a scored bug.');
        const tasks = await api(`${DAG}/dagRuns/${encodeURIComponent(runId)}/taskInstances?limit=100`, signal);
        if (!(tasks.task_instances ?? []).some((task: { state: string }) => ['running', 'queued'].includes(task.state))) return;
      }
      await delay(2000, undefined, { signal });
    }
    throw new Error('Timed out waiting for the Arena DAG.');
  }
  async function prepare(bugs: ArenaBug[], signal: AbortSignal): Promise<ArenaSnapshot> {
    signal.throwIfAborted();
    // Prevent normal /quest repairs, stale source, or external queued runs from
    // silently changing the test. Serialized sources must match this checkout.
    const candidate = await readFile(REAL_DAG_FILE, 'utf8');
    const parseBy = Date.now() + 360000;
    while (true) {
      const source = await api('/dagSources/tennis_tournament_pipeline', signal);
      if (source.content === candidate && candidate.includes('def arena_faults():')) break;
      if (Date.now() > parseBy) throw new Error('Airflow has not parsed the Arena-capable DAG.');
      await delay(3000, undefined, { signal });
    }
    const running = await api(`${DAG}/dagRuns?limit=100&state=running&state=queued`, signal);
    if ((running.dag_runs ?? []).length) throw new Error('Another tennis run is active. Wait before starting Arena.');
    await api(DAG, signal, 'PATCH', { is_paused: false });
    activeRun = `arena_${randomUUID()}`;
    // Durable marker written BEFORE triggering, so interrupted cleanup can recover.
    await writeFile(recoveryFile, JSON.stringify({ runId: activeRun }), { mode: 0o600 });
    await api(`${DAG}/dagRuns`, signal, 'POST', {
      dag_run_id: activeRun, logical_date: null,
      conf: { bug_quest_arena: { half_load: bugs.includes('half_load'), standings_loss: bugs.includes('standings_loss') } },
    });
    await wait(activeRun, signal);
    const counts = await warehouseCounts(activeRun, signal);
    if (counts.extractedRows < 1 || counts.otherRunRows !== 0) throw new Error('Arena warehouse is empty or belongs to another run.');
    const duplicates = await duplicateCount(activeRun, signal);
    const snapshot = { runId: activeRun, counts, duplicates };
    // Score only faults actually reproduced, never a failed injection.
    if (detectedBugs(snapshot).sort().join() !== [...bugs].sort().join()) throw new Error('The DAG did not reproduce the requested Arena baseline. No score awarded.');
    return snapshot;
  }
  async function duplicateCount(runId: string, signal: AbortSignal) {
    // Run IDs are generated by this server; credentials stay in subprocess env.
    if (!/^arena_[a-f0-9-]+$/.test(runId)) throw new Error('Invalid Arena run ID.');
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/KEY|TOKEN|SECRET|AIRFLOW/.test(name)));
    const { stdout } = await exec('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', `SELECT COUNT(*) - COUNT(DISTINCT payload) FROM warehouse.matches WHERE run_id = '${runId}'`], { env: { ...env, NODE_ENV: process.env.NODE_ENV, PGCONNECT_TIMEOUT: '5' }, timeout: 15000, signal });
    const count = Number(stdout.trim());
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid duplicate count.');
    return count;
  }
  async function inspect(check: ArenaCheck, snapshot: ArenaSnapshot, signal: AbortSignal, playerLog: (message: string) => void): Promise<ArenaFinding> {
    if (check.invariant === 'tasks') {
      const target = await createRealAirflow(signal, () => {}, snapshot.runId);
      const result = await target.run({ id: 0, title: check.title, objective: check.objective, kind: 'task_status' }, signal, playerLog);
      if (result.status === 'error') return { invariant: 'tasks', reportedBug: false, error: true, summary: result.summary };
      return { invariant: 'tasks', reportedBug: check.expectsBug || result.status !== 'passed', summary: result.summary, testUrl: result.testUrl };
    }
    // Requery the pinned run to detect an external overwrite before trusting it.
    const c = await warehouseCounts(snapshot.runId, signal);
    if (c.otherRunRows || c.extractedRows !== snapshot.counts.extractedRows) throw new Error('Warehouse changed during a player turn.');
    const healthy = check.invariant === 'rows' ? c.extractedRows === c.matchesLoaded : check.invariant === 'wins' ? c.totalWins === c.matchesLoaded : snapshot.duplicates === 0;
    const detail = check.invariant === 'rows' ? `extracted ${c.extractedRows}; loaded ${c.matchesLoaded}` : check.invariant === 'wins' ? `loaded ${c.matchesLoaded}; total wins ${c.totalWins}` : `duplicate full match payloads ${snapshot.duplicates}`;
    return { invariant: check.invariant, reportedBug: check.expectsBug || !healthy, summary: `${healthy ? 'PASS' : 'FAIL'} · SQL run ${snapshot.runId}: ${detail}.${check.expectsBug && healthy ? ' Claimed defect was not present: false alarm.' : ''}` };
  }
  return {
    prepare,
    expand: (strategy, snapshot, signal, character) => expandArenaStrategy(strategy, { runId: snapshot.runId, extractedRows: snapshot.counts.extractedRows }, signal, character),
    speak: (player, reason, signal) => player.character ? generateCharacterSpeech(player.character, reason, signal) : Promise.resolve(null),
    inspect,
    repair: async (caught, planted, signal, playerLog) => {
      // Arena repairs are isolated runtime remediations, not permanent source edits
      // or /quest's Git-committing fixer. Every player gets the same original faults.
      const remaining = planted.filter(bug => !caught.includes(bug));
      const repaired = await prepare(remaining, signal);
      const browser = await inspect({ title: 'Verify repaired DAG', objective: 'Verify the pinned tennis DAG and all six tasks succeeded.', invariant: 'tasks', expectsBug: false }, repaired, signal, playerLog);
      if (browser.error || browser.reportedBug) { playerLog('Repair was not verified by Kane; no fix points awarded.'); return []; }
      playerLog(`Repair verified on ${repaired.runId}: SQL invariants and Kane + REST passed.`);
      return caught.filter(bug => !detectedBugs(repaired).includes(bug));
    },
    reset: async () => {
      const cleanup = AbortSignal.timeout(1200000);
      try {
        if (!activeRun && await hasArenaRecovery()) {
          const saved = JSON.parse(await readFile(recoveryFile, 'utf8'));
          if (saved.runId !== null && (typeof saved.runId !== 'string' || !/^arena_[a-f0-9-]+$/.test(saved.runId))) throw new Error('Invalid Arena recovery marker.');
          activeRun = saved.runId ?? undefined;
        }
        // Never overlap a reset with a still-running writer after cancellation.
        await writeFile(recoveryFile, JSON.stringify({ runId: activeRun ?? null }), { mode: 0o600 });
        if (activeRun) {
          try { await wait(activeRun, cleanup, true); }
          catch (error) { if (!(error instanceof AirflowHttpError && error.status === 404)) throw error; }
        }
        const clean = await prepare([], cleanup);
        await unlink(recoveryFile);
        log(`Both Arena faults are off; clean run ${clean.runId}: ${clean.counts.extractedRows} extracted / ${clean.counts.matchesLoaded} loaded / ${clean.counts.totalWins} wins.`);
        return clean.runId;
      } catch {
        throw new Error('Arena reset could not be verified. Recovery is required before another game or quest; keep Airflow running and use Recover reset.');
      }
    },
  };
}
