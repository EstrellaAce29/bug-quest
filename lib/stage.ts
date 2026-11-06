import { ANIMALS } from './play-character.mjs';
import type { LiveEvent } from './quest-contract';
import { warehouseErrorMessage } from './warehouse-diagnostics.mjs';

export type StageAgent = {
  id: string; name: string; animal: typeof ANIMALS[number]; color: number;
  points: number; bugs: number; fixes: number; falseAlarms: number; runs: number;
  phase: 'thinking' | 'fixing' | 'idle' | 'stopped'; speech: string;
};
export type StageAward = { seq: number; at: number; agentId: string; amount: 20 | 15 | -5 };
type Run = { generation: number; agentId: string; bugs: number; fixes: number; falseAlarms: number; active: boolean };
export type StageState = { generation: number; agents: Map<string, StageAgent>; runs: Map<string, Run>; awards: StageAward[]; nextSeq: number };
export type StageView = { generation: number; agents: StageAgent[]; standings: StageAgent[]; awards: StageAward[]; cursor: number };
export type StageRun = { id: string; generation: number };

function nameKey(name: string) { return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase(); }
export function animalForName(name: string) {
  let hash = 2166136261;
  for (const char of nameKey(name)) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619) >>> 0;
  return { animal: ANIMALS[hash % ANIMALS.length], color: hash % 4 };
}
export function createStage(): StageState { return { generation: 0, agents: new Map(), runs: new Map(), awards: [], nextSeq: 1 }; }
export function stageErrorSpeech(message: string) {
  const warehouseMessages = ['settings', 'client_missing', 'unavailable', 'authentication', 'timeout', 'no_run', 'query'].map(warehouseErrorMessage);
  if (warehouseMessages.includes(message)) return message;
  if (/^Airflow (authentication|request) failed \(HTTP \d{3}\)\.$/.test(message)) return `${message} Check Airflow and your local credentials.`;
  if (message === 'Complete the tennis DAG successfully before starting this quest.') return message;
  if (/^Kane (stopped before returning a result|could not start or connect to Chrome|authentication needs attention|exited without a completed result)/.test(message)) {
    return message.startsWith('Kane authentication') ? 'Kane authentication needs attention. Run kane-cli login --oauth.'
      : message.startsWith('Kane could not') ? 'Kane could not connect to Chrome. Check that Chrome is installed.'
      : 'Kane did not finish its browser check. Check the control screen and retry.';
  }
  return 'Quest failed. Open controls for the error details.';
}
export function reconcileStageAnimals(state: StageState) {
  const taken = new Set<StageAgent['animal']>();
  for (const agent of state.agents.values()) {
    if (taken.has(agent.animal)) {
      const start = ANIMALS.indexOf(agent.animal);
      const available = ANIMALS.map((_, offset) => ANIMALS[(start + offset) % ANIMALS.length]).find(animal => !taken.has(animal));
      if (available) agent.animal = available;
    }
    taken.add(agent.animal);
    if (agent.speech === 'A snag in the trail. Check the control screen.') agent.speech = 'Quest needs attention. Open controls for details.';
  }
}
export function beginStageRun(state: StageState, name: string, runId: string): StageRun {
  if (state.runs.has(runId)) throw new Error('Stage run already exists.');
  const key = nameKey(name);
  let agent = state.agents.get(key);
  if (!agent) {
    const character = animalForName(name);
    const taken = new Set([...state.agents.values()].map(agent => agent.animal));
    const start = ANIMALS.indexOf(character.animal);
    // Preserve the name's default unless it conflicts with this session's roster.
    const animal = ANIMALS.map((_, offset) => ANIMALS[(start + offset) % ANIMALS.length]).find(animal => !taken.has(animal));
    if (!animal) throw new Error('All eight stage animals are taken. Reset the leaderboard before adding a new agent.');
    agent = { id: `agent-${state.nextSeq++}`, name, ...character, animal, points: 0, bugs: 0, fixes: 0, falseAlarms: 0, runs: 0, phase: 'idle', speech: '' };
    state.agents.set(key, agent);
  }
  agent.runs++; agent.phase = 'thinking'; agent.speech = 'Following the evidence, one check at a time.';
  state.runs.set(runId, { generation: state.generation, agentId: agent.id, bugs: 0, fixes: 0, falseAlarms: 0, active: true });
  return { id: runId, generation: state.generation };
}
export function recordStageEvent(state: StageState, handle: StageRun, event: LiveEvent, now = Date.now()) {
  const run = state.runs.get(handle.id);
  if (!run?.active || run.generation !== state.generation || handle.generation !== state.generation) return;
  const agent = [...state.agents.values()].find(a => a.id === run.agentId)!;
  if (event.type === 'result' || event.type === 'fix' || event.type === 'done') {
    const counts = { bugs: event.bugsFound, fixes: event.fixesVerified ?? run.fixes, falseAlarms: event.falseAlarms ?? run.falseAlarms };
    const rules = [['bugs', 20], ['fixes', 15], ['falseAlarms', -5]] as const;
    for (const [field, amount] of rules) {
      const count = counts[field];
      if (!Number.isSafeInteger(count) || count < run[field]) continue;
      for (let n = run[field]; n < count; n++) {
        agent[field]++; agent.points += amount;
        state.awards.push({ seq: state.nextSeq++, at: now, agentId: agent.id, amount });
        agent.speech = amount === 20 ? 'Caught a quiet bug hiding in the numbers!' : amount === 15 ? 'The fix holds. Every row accounted for.' : 'I called that too soon. Back to the evidence.';
      }
      run[field] = count;
    }
    state.awards = state.awards.slice(-500);
  }
  if (event.type === 'result') agent.phase = 'thinking';
  if (event.type === 'fix') agent.phase = event.report.status === 'fixing' ? 'fixing' : 'thinking';
  if (event.type === 'error') {
    agent.phase = 'stopped';
    agent.speech = stageErrorSpeech(event.message);
    run.active = false;
  }
  if (event.type === 'done') {
    agent.phase = event.escalated ? 'stopped' : 'idle'; run.active = false;
    if (!run.bugs && !run.falseAlarms) agent.speech = event.escalated ? 'This one needs a human eye.' : 'Checks complete. No silent bug confirmed.';
    else if (event.escalated) agent.speech = 'Evidence saved. A human can take it from here.';
  }
}
export function finishStageRun(state: StageState, handle: StageRun) {
  const run = state.runs.get(handle.id);
  if (!run?.active || handle.generation !== state.generation) return;
  run.active = false;
  const agent = [...state.agents.values()].find(a => a.id === run.agentId);
  if (agent) { agent.phase = 'stopped'; agent.speech = 'Quest stopped. The evidence stays on the control screen.'; }
}
export function resetStage(state: StageState) {
  state.generation++; state.agents.clear(); state.runs.clear(); state.awards = []; state.nextSeq++;
}
export function stageView(state: StageState, after = 0): StageView {
  const agents = [...state.agents.values()].map(a => ({ ...a }));
  return { generation: state.generation, agents, standings: [...agents].sort((a, b) => b.points - a.points || a.id.localeCompare(b.id, undefined, { numeric: true })), awards: state.awards.filter(a => a.seq > after).map(a => ({ ...a })), cursor: state.nextSeq - 1 };
}
