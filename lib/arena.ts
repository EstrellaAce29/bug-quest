import type { WarehouseCounts } from './warehouse-check';

export const BUGS = ['half_load', 'standings_loss'] as const;
export type ArenaBug = typeof BUGS[number];
export const BUG_LABELS: Record<ArenaBug, string> = {
  half_load: 'Half-batch load: only the first half of extracted matches are written',
  standings_loss: 'Standings undercount: one win per player is dropped',
};
export type ArenaPlayer = { id: string; name: string; strategy: string };
export type ArenaCheck = { title: string; objective: string; invariant: 'rows' | 'wins' | 'duplicates' | 'tasks'; expectsBug: boolean };
export type ArenaSnapshot = { runId: string; counts: WarehouseCounts; duplicates: number };
export type ArenaFinding = { invariant: ArenaCheck['invariant']; reportedBug: boolean; error?: boolean; summary: string; testUrl?: string | null };
export type ArenaScore = { playerId: string; caught: ArenaBug[]; fixed: ArenaBug[]; falseAlarms: number; points: number };
export type RoundSummary = { round: number; planted: ArenaBug[]; scores: ArenaScore[]; resetRunId: string };
export type ArenaEvent =
  | { type: 'log'; playerId: string | null; message: string }
  | { type: 'turn'; playerId: string; runId: string }
  | { type: 'plan'; playerId: string; checks: ArenaCheck[] }
  | { type: 'finding'; playerId: string; finding: ArenaFinding }
  | { type: 'score'; score: Omit<ArenaScore, 'caught' | 'fixed'> & { caught: number; fixed: number } }
  | { type: 'summary'; summary: RoundSummary }
  | { type: 'error'; message: string };

export function validatePlayers(value: unknown): ArenaPlayer[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 4) throw new Error('Choose 2–4 players.');
  const players = value.map((p, index) => {
    if (!p || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 60 || typeof p.strategy !== 'string' || !p.strategy.trim() || p.strategy.length > 1000) throw new Error('Each player needs an agent name (60 characters max) and strategy (1,000 characters max).');
    return { id: `player-${index + 1}`, name: p.name.trim(), strategy: p.strategy.trim() };
  });
  if (new Set(players.map(p => p.name.toLowerCase())).size !== players.length) throw new Error('Give each agent a different name.');
  return players;
}

export function validateArenaPlan(value: unknown): ArenaCheck[] {
  const checks = (value as { checks?: unknown })?.checks;
  if (!Array.isArray(checks) || checks.length < 1 || checks.length > 3) throw new Error('The model must return 1–3 checks.');
  if (checks.some(c => !c || !['rows', 'wins', 'duplicates', 'tasks'].includes(c.invariant) || typeof c.expectsBug !== 'boolean' || typeof c.title !== 'string' || !c.title.trim() || c.title.length > 120 || typeof c.objective !== 'string' || !c.objective.trim() || c.objective.length > 2000)) throw new Error('The model returned an invalid Arena check.');
  if (new Set(checks.map(c => c.invariant)).size !== checks.length) throw new Error('The model repeated an invariant.');
  return checks;
}

export function chooseBugs(randomInt: (max: number) => number): ArenaBug[] {
  return randomInt(2) === 0 ? [BUGS[randomInt(BUGS.length)]] : [...BUGS];
}

export function detectedBugs(snapshot: ArenaSnapshot): ArenaBug[] {
  const c = snapshot.counts;
  const found: ArenaBug[] = [];
  if (c.matchesLoaded !== c.extractedRows) found.push('half_load');
  if (c.totalWins !== c.matchesLoaded) found.push('standings_loss');
  return found;
}

export function scoreFindings(playerId: string, planted: ArenaBug[], findings: ArenaFinding[], fixed: ArenaBug[] = []): ArenaScore {
  const caught = new Set<ArenaBug>();
  const alarms = new Set<string>();
  for (const f of findings) {
    if (f.error || !f.reportedBug) continue;
    const bug = f.invariant === 'rows' ? 'half_load' : f.invariant === 'wins' ? 'standings_loss' : null;
    if (bug && planted.includes(bug)) caught.add(bug); else alarms.add(f.invariant);
  }
  const verified = [...new Set(fixed)].filter(bug => caught.has(bug));
  return { playerId, caught: [...caught], fixed: verified, falseAlarms: alarms.size, points: caught.size * 20 + verified.length * 15 - alarms.size * 5 };
}

export type ArenaDependencies = {
  prepare: (bugs: ArenaBug[], signal: AbortSignal) => Promise<ArenaSnapshot>;
  expand: (strategy: string, snapshot: ArenaSnapshot, signal: AbortSignal) => Promise<ArenaCheck[]>;
  inspect: (check: ArenaCheck, snapshot: ArenaSnapshot, signal: AbortSignal, log: (message: string) => void) => Promise<ArenaFinding>;
  repair: (caught: ArenaBug[], planted: ArenaBug[], signal: AbortSignal, log: (message: string) => void) => Promise<ArenaBug[]>;
  reset: () => Promise<string>;
};

export async function runArenaRound(round: number, players: ArenaPlayer[], planted: ArenaBug[], deps: ArenaDependencies, signal: AbortSignal, emit: (e: ArenaEvent) => void): Promise<RoundSummary> {
  const scores: ArenaScore[] = [];
  let resetRunId = '';
  try {
    for (const player of players) {
      signal.throwIfAborted();
      const log = (message: string) => emit({ type: 'log', playerId: player.id, message });
      log('Preparing a fresh run with this round’s hidden faults.');
      const snapshot = await deps.prepare(planted, signal);
      emit({ type: 'turn', playerId: player.id, runId: snapshot.runId });
      log('Expanding your coaching strategy into precise checks.');
      const checks = await deps.expand(player.strategy, snapshot, signal);
      emit({ type: 'plan', playerId: player.id, checks });
      const findings: ArenaFinding[] = [];
      for (const check of checks) {
        signal.throwIfAborted();
        const finding = await deps.inspect(check, snapshot, signal, log);
        findings.push(finding);
        emit({ type: 'finding', playerId: player.id, finding });
      }
      let score = scoreFindings(player.id, planted, findings);
      if (score.caught.length) {
        log('Attempting an isolated repair; a fresh run must pass the repaired checks and Kane status verification.');
        const fixed = await deps.repair(score.caught, planted, signal, log);
        score = scoreFindings(player.id, planted, findings, fixed);
      }
      scores.push(score);
      emit({ type: 'score', score: { ...score, caught: score.caught.length, fixed: score.fixed.length } });
      log(`Turn complete: ${score.points} points.`);
    }
  } finally {
    emit({ type: 'log', playerId: null, message: 'Resetting both Arena faults off and verifying a clean warehouse run.' });
    // Independent cleanup must finish even after Stop, disconnect, or a model/browser failure.
    resetRunId = await deps.reset();
  }
  const summary = { round, planted, scores, resetRunId };
  emit({ type: 'summary', summary });
  return summary;
}
