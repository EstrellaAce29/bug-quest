import { validateCharacter, publishableSpeech, containsPrivateEcho } from './arena-character.mjs';
import type { WarehouseCounts } from './warehouse-check';

export const BUGS = ['half_load', 'standings_loss'] as const;
export type ArenaBug = typeof BUGS[number];
export const BUG_LABELS: Record<ArenaBug, string> = {
  half_load: 'Half-batch load: only the first half of extracted matches are written',
  standings_loss: 'Standings undercount: one win per player is dropped',
};
export type ArenaCharacter = ReturnType<typeof validateCharacter>;
export type SpeechReason = 'catch' | 'fix' | 'false_alarm' | 'miss';
export type ArenaPlayer = { id: string; name: string; strategy: string; character?: ArenaCharacter };
export type ArenaCheck = { title: string; objective: string; invariant: 'rows' | 'wins' | 'duplicates' | 'tasks'; expectsBug: boolean };
export type ArenaSnapshot = { runId: string; counts: WarehouseCounts; duplicates: number };
export type ArenaFinding = { invariant: ArenaCheck['invariant']; reportedBug: boolean; error?: boolean; summary: string; testUrl?: string | null };
export type ArenaScore = { playerId: string; caught: ArenaBug[]; fixed: ArenaBug[]; falseAlarms: number; points: number };
export type RoundSummary = { round: number; planted: ArenaBug[]; scores: ArenaScore[]; resetRunId: string };
export type ArenaEvent =
  | { type: 'joined'; playerId: string; name: string; animal?: string; publicBio: string }
  | { type: 'speech'; playerId: string; text: string; reason: SpeechReason }
  | { type: 'award'; playerId: string; amount: 20 | 15 | -5; reason: 'catch' | 'fix' | 'false_alarm' }
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
    return { id: `player-${index + 1}`, name: p.name.trim(), strategy: p.strategy.trim(), ...(p.character ? { character: validateCharacter(p.character) } : {}) };
  });
  if (new Set(players.map(p => p.name.toLowerCase())).size !== players.length) throw new Error('Give each agent a different name.');
  return players;
}

export function validateArenaPlan(value: unknown): ArenaCheck[] {
  const checks = (value as { checks?: unknown })?.checks;
  if (!Array.isArray(checks) || checks.length < 1 || checks.length > 3) throw new Error('The model must return 1–3 checks.');
  if (checks.some(c => !c || !['rows', 'wins', 'duplicates', 'tasks'].includes(c.invariant) || typeof c.expectsBug !== 'boolean' || typeof c.title !== 'string' || !c.title.trim() || c.title.length > 120 || typeof c.objective !== 'string' || !c.objective.trim() || c.objective.length > 2000)) throw new Error('The model returned an invalid Bug Quest check.');
  if (new Set(checks.map(c => c.invariant)).size !== checks.length) throw new Error('The model repeated an invariant.');
  return checks.map(({ title, objective, invariant, expectsBug }) => ({ title, objective, invariant, expectsBug }));
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
  expand: (strategy: string, snapshot: ArenaSnapshot, signal: AbortSignal, character?: ArenaCharacter) => Promise<ArenaCheck[]>;
  speak?: (player: ArenaPlayer, reason: SpeechReason, signal: AbortSignal) => Promise<string | null>;
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
      const checks = validateArenaPlan({ checks: await deps.expand(player.strategy, snapshot, signal, player.character) });
      if (player.character && checks.some(check => containsPrivateEcho(`${check.title} ${check.objective}`, player.character!.privateCharacter))) throw new Error('Character-aware checks could not be published privately.');
      emit({ type: 'plan', playerId: player.id, checks });
      const findings: ArenaFinding[] = [];
      let awardedCatches = 0;
      let awardedAlarms = 0;
      for (const check of checks) {
        signal.throwIfAborted();
        const finding = await deps.inspect(check, snapshot, signal, log);
        findings.push(finding);
        emit({ type: 'finding', playerId: player.id, finding });
        const progress = scoreFindings(player.id, planted, findings);
        for (; awardedCatches < progress.caught.length; awardedCatches++) emit({ type: 'award', playerId: player.id, amount: 20, reason: 'catch' });
        for (; awardedAlarms < progress.falseAlarms; awardedAlarms++) emit({ type: 'award', playerId: player.id, amount: -5, reason: 'false_alarm' });
      }
      const say = async (reason: SpeechReason) => {
        if (!player.character || !deps.speak) return;
        try {
          signal.throwIfAborted();
          const text = await deps.speak(player, reason, signal);
          if (publishableSpeech(text, player.character)) emit({ type: 'speech', playerId: player.id, text: text!.trim(), reason });
        } catch { signal.throwIfAborted(); /* Cosmetic speech never changes scores. */ }
      };
      let score = scoreFindings(player.id, planted, findings);
      await say(score.caught.length ? 'catch' : score.falseAlarms ? 'false_alarm' : 'miss');
      if (score.caught.length) {
        log('Attempting an isolated repair; a fresh run must pass the repaired checks and Kane status verification.');
        const fixed = await deps.repair(score.caught, planted, signal, log);
        score = scoreFindings(player.id, planted, findings, fixed);
        for (const _bug of score.fixed) emit({ type: 'award', playerId: player.id, amount: 15, reason: 'fix' });
        if (score.fixed.length) await say('fix');
      }
      scores.push(score);
      emit({ type: 'score', score: { ...score, caught: score.caught.length, fixed: score.fixed.length } });
      log(`Turn complete: ${score.points} points.`);
    }
  } finally {
    emit({ type: 'log', playerId: null, message: 'Resetting both Bug Quest faults off and verifying a clean warehouse run.' });
    // Independent cleanup must finish even after Stop, disconnect, or a model/browser failure.
    resetRunId = await deps.reset();
  }
  const summary = { round, planted, scores, resetRunId };
  emit({ type: 'summary', summary });
  return summary;
}
