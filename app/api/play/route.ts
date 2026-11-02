import { randomInt, randomUUID } from 'node:crypto';
import { after } from 'next/server';
import { chooseBugs, runPlayRound, type PlayEvent } from '@/lib/play';
import { createRoom, joinRoom, requireHost, roomPlayer, roomView, startRoom, submitStrategy, recordRoomEvent, finishRoomJob, type PlayRoom } from '@/lib/play-room';
import { modelSettings } from '@/lib/model-provider';
import { playAirflow, hasPlayRecovery } from '@/lib/server/play-airflow';
import { redact } from '@/lib/quest-contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 7200;
const state = globalThis as typeof globalThis & {
  bugQuestLiveBusy?: boolean; playCleanupRequired?: boolean; playRecovering?: boolean; playRooms?: Map<string, PlayRoom>;
};
const rooms = state.playRooms ??= new Map();
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function code() { return Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join(''); }
function local(request: Request) {
  const origin = request.headers.get('origin');
  return ['localhost:3000', '127.0.0.1:3000'].includes(request.headers.get('host') ?? '') && (!origin || ['http://localhost:3000', 'http://127.0.0.1:3000'].includes(origin));
}

export async function POST(request: Request) {
  if (!local(request)) return Response.json({ error: 'Use the local Bug Quest server on port 3000.' }, { status: 403 });
  if (!request.headers.get('content-type')?.includes('application/json')) return Response.json({ error: 'Send JSON.' }, { status: 415 });
  const text = await request.text();
  if (text.length > 10000) return Response.json({ error: 'Bug Quest input is too long.' }, { status: 400 });
  let input;
  try { input = JSON.parse(text); } catch { return Response.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  if (!input || typeof input !== 'object') return Response.json({ error: 'Invalid request.' }, { status: 400 });
  const secrets = Object.entries(process.env).filter(([name]) => /KEY|PASSWORD|SECRET|TOKEN/.test(name)).map(([, value]) => value || '');
  const safe = (message: string) => redact(message, secrets);
  if (input.action === 'create') {
    try {
      modelSettings();
      for (const [key, room] of rooms) if (Date.now() - room.created > 86400000 && !room.controller) rooms.delete(key);
      if (rooms.size >= 20) throw new Error('Too many lobbies. Restart the server to clear old games.');
      let joinCode = code(); while (rooms.has(joinCode)) joinCode = code();
      const room = createRoom(joinCode, randomUUID(), input.capacity);
      rooms.set(joinCode, room);
      return Response.json({ hostToken: room.hostToken, room: roomView(room) });
    } catch (error) { return Response.json({ error: safe(error instanceof Error ? error.message : 'Invalid lobby.') }, { status: 400 }); }
  }
  const room = typeof input.code === 'string' ? rooms.get(input.code.toUpperCase()) : undefined;
  if (!room) return Response.json({ error: 'Game code not found or expired. Ask the host for the current code.' }, { status: 404 });
  try {
    if (input.action === 'state') {
      if (input.playerToken) roomPlayer(room, input.playerToken);
      return Response.json({ room: roomView(room, Number.isSafeInteger(input.after) && input.after >= 0 ? input.after : 0, input.playerToken), recovery: !!state.playCleanupRequired || (!state.bugQuestLiveBusy && await hasPlayRecovery()) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (input.action === 'join') {
      const player = joinRoom(room, input.name, randomUUID(), Date.now(), input.character);
      recordRoomEvent(room, { type: 'joined', playerId: player.id, name: player.name, animal: player.character?.animal ?? 'rabbit', publicBio: player.character?.publicBio ?? '' });
      return Response.json({ playerId: player.id, playerToken: player.token, room: roomView(room, 0, player.token) });
    }
    if (input.action === 'strategy') {
      submitStrategy(room, input.playerToken, input.round, input.strategy);
      return Response.json({ room: roomView(room, 0, input.playerToken) });
    }
    // Codes are invitations, not host credentials. Terminals cannot start, stop,
    // recover, or impersonate another player's controller.
    try { requireHost(room, input.hostToken); }
    catch { return Response.json({ error: 'Only the browser host can control rounds.' }, { status: 403 }); }
    if (input.action === 'stop') {
      if (!room.controller) throw new Error('No round is running in this lobby.');
      room.controller.abort(); room.phase = 'resetting';
      return Response.json({ stopping: true });
    }
    if (input.action === 'recover') {
      if (state.playRecovering || (state.bugQuestLiveBusy && !state.playCleanupRequired)) return Response.json({ error: 'A quest or round is still running.' }, { status: 409 });
      state.bugQuestLiveBusy = true; state.playRecovering = true; room.phase = 'resetting';
      try {
        const runId = await playAirflow(message => recordRoomEvent(room, { type: 'log', playerId: null, message: safe(message) })).reset();
        state.playCleanupRequired = false; state.bugQuestLiveBusy = false;
        finishRoomJob(room, false); room.error = null;
        return Response.json({ runId });
      } catch {
        state.playCleanupRequired = true; room.phase = 'recovery';
        return Response.json({ error: 'Reset is still pending. Confirm Airflow is reachable, then retry Recover reset.' }, { status: 503 });
      } finally { state.playRecovering = false; }
    }
    if (input.action !== 'start') throw new Error('Unknown Bug Quest action.');
    if (state.bugQuestLiveBusy) return Response.json({ error: 'Another quest or Bug Quest round is running.' }, { status: 409 });
    if (state.playCleanupRequired || await hasPlayRecovery()) return Response.json({ error: 'An interrupted round needs Recover reset first.' }, { status: 409 });
    modelSettings();
    // Recheck after filesystem awaits to acquire the shared quest lock atomically.
    if (state.bugQuestLiveBusy) return Response.json({ error: 'Another round just started.' }, { status: 409 });
    const players = startRoom(room, input.hostToken, input.round);
    state.bugQuestLiveBusy = true;
    const signal = room.controller!.signal;
    const round = room.rounds.length + 1;
    after(async () => {
      const emit = (event: PlayEvent) => recordRoomEvent(room, JSON.parse(safe(JSON.stringify(event))));
      const heartbeat = setInterval(() => emit({ type: 'log', playerId: null, message: 'Airflow and agent checks are still running…' }), 15000);
      try {
        await runPlayRound(round, players, chooseBugs(randomInt), playAirflow(message => emit({ type: 'log', playerId: null, message })), signal, emit);
      } catch (error) {
        emit({ type: 'error', message: signal.aborted ? 'Round stopped. Its scores are void; faults are being reset.' : safe(error instanceof Error ? error.message : 'Round failed; no round scores saved.') });
      } finally {
        clearInterval(heartbeat);
        try { state.playCleanupRequired = await hasPlayRecovery(); }
        catch { state.playCleanupRequired = true; }
        state.bugQuestLiveBusy = state.playCleanupRequired;
        finishRoomJob(room, !!state.playCleanupRequired);
      }
    });
    return Response.json({ room: roomView(room) }, { status: 202 });
  } catch (error) { return Response.json({ error: safe(error instanceof Error ? error.message : 'Bug Quest request failed.') }, { status: 400 }); }
}
