import { randomInt, randomUUID } from 'node:crypto';
import { chooseBugs, runArenaRound, validatePlayers, type ArenaEvent, type ArenaPlayer, type RoundSummary } from '@/lib/arena';
import { modelSettings } from '@/lib/model-provider';
import { arenaAirflow, hasArenaRecovery } from '@/lib/server/arena-airflow';
import { redact } from '@/lib/quest-contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 7200;
type Game = { id: string; players: ArenaPlayer[]; rounds: RoundSummary[]; created: number };
const state = globalThis as typeof globalThis & {
  bugQuestLiveBusy?: boolean; arenaCleanupRequired?: boolean; arenaRecovering?: boolean; arenaGames?: Map<string, Game>;
};
const games = state.arenaGames ??= new Map();

function local(request: Request) {
  const host = request.headers.get('host');
  const origin = request.headers.get('origin');
  return ['localhost:3000', '127.0.0.1:3000'].includes(host ?? '') && (!origin || ['http://localhost:3000', 'http://127.0.0.1:3000'].includes(origin));
}

export async function POST(request: Request) {
  if (!local(request)) return Response.json({ error: 'Use the local Arena page on port 3000.' }, { status: 403 });
  if (!request.headers.get('content-type')?.includes('application/json')) return Response.json({ error: 'Send JSON.' }, { status: 415 });
  const text = await request.text();
  if (text.length > 10000) return Response.json({ error: 'Arena input is too long.' }, { status: 400 });
  let input;
  try { input = JSON.parse(text); } catch { return Response.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  if (!input || typeof input !== 'object') return Response.json({ error: 'Invalid Arena request.' }, { status: 400 });
  const secrets = Object.entries(process.env).filter(([name]) => /KEY|PASSWORD|SECRET|TOKEN/.test(name)).map(([, value]) => value || '');
  const safe = (message: string) => redact(message, secrets);
  if (input.action === 'resume') {
    const game = games.get(input.gameId);
    return game ? Response.json({ game, recovery: state.arenaCleanupRequired || await hasArenaRecovery(), busy: !!state.bugQuestLiveBusy }) : Response.json({ error: 'Game expired. Start a new game.' }, { status: 404 });
  }
  if (input.action === 'recover') {
    if (state.arenaRecovering || (state.bugQuestLiveBusy && !state.arenaCleanupRequired)) return Response.json({ error: 'A quest or round is running.' }, { status: 409 });
    state.bugQuestLiveBusy = true; state.arenaRecovering = true;
    try {
      const runId = await arenaAirflow(() => {}).reset();
      state.arenaCleanupRequired = false; state.bugQuestLiveBusy = false;
      return Response.json({ runId });
    } catch {
      state.arenaCleanupRequired = true;
      return Response.json({ error: 'Reset is still pending. Confirm Airflow is reachable, then retry Recover reset.' }, { status: 503 });
    } finally { state.arenaRecovering = false; }
  }
  if (state.bugQuestLiveBusy) return Response.json({ error: 'Another quest or Arena round is running.' }, { status: 409 });
  if (state.arenaCleanupRequired || await hasArenaRecovery()) return Response.json({ error: 'An interrupted round needs recovery. Click Recover reset first.' }, { status: 409 });
  if (input.action === 'create') {
    try {
      modelSettings();
      const players = validatePlayers(input.players);
      for (const [id, game] of games) if (Date.now() - game.created > 86400000) games.delete(id);
      if (games.size >= 20) return Response.json({ error: 'Too many active games. Restart the dev server to clear old games.' }, { status: 429 });
      const game = { id: randomUUID(), players, rounds: [], created: Date.now() };
      games.set(game.id, game);
      return Response.json({ game });
    } catch (error) { return Response.json({ error: safe(error instanceof Error ? error.message : 'Invalid setup.') }, { status: 400 }); }
  }
  if (input.action !== 'round') return Response.json({ error: 'Unknown Arena action.' }, { status: 400 });
  const game = games.get(input.gameId);
  if (!game) return Response.json({ error: 'Game expired. Start a new game.' }, { status: 404 });
  if (game.rounds.length >= 3) return Response.json({ error: 'This three-round game is complete.' }, { status: 409 });
  if (input.round !== game.rounds.length + 1) return Response.json({ error: 'Round already completed. Reload this game.' }, { status: 409 });
  let players: ArenaPlayer[];
  try {
    modelSettings();
    players = validatePlayers(input.players);
    if (players.length !== game.players.length || players.some((p, i) => p.name !== game.players[i].name)) throw new Error('Player roster is locked after setup; edit strategies only.');
  } catch (error) { return Response.json({ error: safe(error instanceof Error ? error.message : 'Invalid players.') }, { status: 400 }); }
  if (state.bugQuestLiveBusy) return Response.json({ error: 'Another quest or round just started.' }, { status: 409 });
  state.bugQuestLiveBusy = true;
  const abort = new AbortController();
  const disconnect = () => abort.abort();
  request.signal.addEventListener('abort', disconnect, { once: true });
  if (request.signal.aborted) abort.abort();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: ArenaEvent) => {
        if (closed) return;
        try { controller.enqueue(new TextEncoder().encode(safe(JSON.stringify(event)) + '\n')); }
        catch { closed = true; abort.abort(); }
      };
      const heartbeat = setInterval(() => emit({ type: 'log', playerId: null, message: 'Round in progress; Airflow, model, and browser checks can take a few minutes.' }), 15000);
      try {
        game.players = players;
        const deps = arenaAirflow(message => emit({ type: 'log', playerId: null, message }));
        const summary = await runArenaRound(game.rounds.length + 1, players, chooseBugs(randomInt), deps, abort.signal, emit);
        game.rounds.push(summary);
      } catch (error) {
        emit({ type: 'error', message: safe(error instanceof Error ? error.message : 'Round failed. No round scores saved.') });
      } finally {
        clearInterval(heartbeat);
        request.signal.removeEventListener('abort', disconnect);
        state.arenaCleanupRequired = await hasArenaRecovery();
        // Keep /quest and other Arena requests locked if cleanup is unverified.
        state.bugQuestLiveBusy = state.arenaCleanupRequired;
        if (!closed) { closed = true; try { controller.close(); } catch { /* Disconnected client. */ } }
      }
    },
    cancel() { closed = true; abort.abort(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' } });
}
