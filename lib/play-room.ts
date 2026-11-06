import { ANIMALS, validateCharacter } from './play-character.mjs';
import type { PlayEvent, PlayPlayer, RoundSummary } from './play';

export type RoomPhase = 'lobby' | 'coaching' | 'running' | 'resetting' | 'finished' | 'recovery';
export type RoomPlayer = PlayPlayer & { token: string; strategyRound: number; lastSeen: number; animal: string };
export type RoomEvent = { seq: number; at: number; round: number; event: PlayEvent };
export type Standing = { playerId: string; name: string; points: number; caught: number; fixed: number; falseAlarms: number };
export type PlayRoom = {
  code: string; hostToken: string; capacity: number; created: number; phase: RoomPhase; rosterLocked: boolean;
  players: RoomPlayer[]; rounds: RoundSummary[]; events: RoomEvent[]; nextSeq: number;
  live: Record<string, Omit<Standing, 'name'>>; error: string | null; controller?: AbortController;
};
export type RoomView = {
  code: string; capacity: number; phase: RoomPhase; round: number; canStart: boolean;
  players: { id: string; name: string; animal: string; publicBio: string; ready: boolean; connected: boolean }[];
  standings: Standing[]; rounds: RoundSummary[]; events: RoomEvent[]; cursor: number; error: string | null;
  self?: { id: string; name: string; ready: boolean };
};

export function createRoom(code: string, hostToken: string, capacity: unknown, now = Date.now()): PlayRoom {
  if (!Number.isInteger(capacity) || Number(capacity) < 2 || Number(capacity) > 4) throw new Error('Choose 2–4 player slots.');
  return { code, hostToken, capacity: Number(capacity), created: now, phase: 'lobby', rosterLocked: false, players: [], rounds: [], events: [], nextSeq: 1, live: {}, error: null };
}
export function joinRoom(room: PlayRoom, name: unknown, token: string, now = Date.now(), character?: unknown) {
  if (room.phase !== 'lobby' || room.rosterLocked) throw new Error('The roster is locked after the first round starts.');
  if (room.players.length >= room.capacity) throw new Error('This lobby is full.');
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 60 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('Use an agent name of 1–60 printable characters.');
  if (room.players.some(p => p.name.toLowerCase() === name.trim().toLowerCase())) throw new Error('That agent name is already taken.');
  const profile = character === undefined ? undefined : validateCharacter(character);
  const taken = new Set(room.players.map(player => player.animal));
  if (profile && taken.has(profile.animal)) throw new Error(`The ${profile.animal} is already taken in this session. Choose a different animal.`);
  const animal = profile?.animal ?? ANIMALS.find(animal => !taken.has(animal))!;
  const player = { id: `player-${room.players.length + 1}`, name: name.trim(), animal, strategy: '', token, strategyRound: 0, lastSeen: now, ...(profile ? { character: profile } : {}) };
  room.players.push(player);
  return player;
}
export function roomPlayer(room: PlayRoom, token: unknown) {
  const player = typeof token === 'string' ? room.players.find(p => p.token === token) : undefined;
  if (!player) throw new Error('Invalid player session. Rejoin with your saved controller session.');
  return player;
}
export function requireHost(room: PlayRoom, token: unknown) {
  if (typeof token !== 'string' || token !== room.hostToken) throw new Error('Only the browser host can control rounds.');
}
export function submitStrategy(room: PlayRoom, token: unknown, round: unknown, strategy: unknown, now = Date.now()) {
  const player = roomPlayer(room, token);
  if (!['lobby', 'coaching'].includes(room.phase)) throw new Error('Strategies are locked while a round runs.');
  if (round !== room.rounds.length + 1 || Number(round) > 3) throw new Error('That strategy belongs to a different round.');
  if (typeof strategy !== 'string' || !strategy.trim() || strategy.trim().length > 1000 || /[\x00-\x08\x0b-\x1f\x7f]/.test(strategy)) throw new Error('Enter a strategy of 1–1,000 printable characters.');
  player.strategy = strategy.trim(); player.strategyRound = Number(round); player.lastSeen = now;
}
export function canStartRoom(room: PlayRoom, now = Date.now()) {
  return ['lobby', 'coaching'].includes(room.phase) && room.rounds.length < 3 && room.players.length >= 2 && room.players.every(p => p.strategyRound === room.rounds.length + 1 && now - p.lastSeen < 15000);
}
export function startRoom(room: PlayRoom, token: unknown, round: unknown, now = Date.now()): PlayPlayer[] {
  requireHost(room, token);
  if (round !== room.rounds.length + 1) throw new Error('The requested round is stale.');
  if (!canStartRoom(room, now)) throw new Error('Wait for at least two connected players and a strategy from every joined player.');
  room.phase = 'running'; room.rosterLocked = true; room.error = null; room.live = {}; room.controller = new AbortController();
  return room.players.map(({ id, name, strategy, character }) => ({ id, name, strategy, ...(character ? { character: structuredClone(character) } : {}) }));
}
export function recordRoomEvent(room: PlayRoom, event: PlayEvent, now = Date.now()) {
  const round = Math.min(room.rounds.length + 1, 3);
  room.events.push({ seq: room.nextSeq++, at: now, round, event });
  if (room.events.length > 2000) room.events.splice(0, room.events.length - 2000);
  if (event.type === 'award') {
    const score = room.live[event.playerId] ??= { playerId: event.playerId, points: 0, caught: 0, fixed: 0, falseAlarms: 0 };
    score.points += event.amount;
    if (event.reason === 'catch') score.caught++;
    if (event.reason === 'fix') score.fixed++;
    if (event.reason === 'false_alarm') score.falseAlarms++;
  } else if (event.type === 'score') room.live[event.score.playerId] = event.score;
  else if (event.type === 'log' && event.playerId === null && event.message.startsWith('Resetting')) room.phase = 'resetting';
  else if (event.type === 'summary') {
    if (event.summary.round !== room.rounds.length + 1) throw new Error('Out-of-order round summary.');
    room.rounds.push(event.summary); room.live = {};
    room.phase = room.rounds.length === 3 ? 'finished' : 'coaching';
  } else if (event.type === 'error') { room.error = event.message; room.live = {}; }
}
export function finishRoomJob(room: PlayRoom, recovery: boolean) {
  room.controller = undefined;
  if (recovery) room.phase = 'recovery';
  else if (['running', 'resetting', 'recovery'].includes(room.phase)) {
    room.phase = room.rounds.length === 3 ? 'finished' : room.rosterLocked ? 'coaching' : 'lobby'; room.live = {};
    // A voided round asks all terminal players for fresh coaching before retrying.
    for (const p of room.players) p.strategyRound = 0;
  }
}
export function roomView(room: PlayRoom, after = 0, playerToken?: string, now = Date.now()): RoomView {
  const self = playerToken ? roomPlayer(room, playerToken) : undefined;
  if (self) self.lastSeen = now;
  const standings = room.players.map(p => {
    const saved = room.rounds.flatMap(r => r.scores).filter(s => s.playerId === p.id);
    const live = room.live[p.id];
    return { playerId: p.id, name: p.name, points: saved.reduce((sum, s) => sum + s.points, 0) + (live?.points ?? 0), caught: saved.reduce((sum, s) => sum + s.caught.length, 0) + (live?.caught ?? 0), fixed: saved.reduce((sum, s) => sum + s.fixed.length, 0) + (live?.fixed ?? 0), falseAlarms: saved.reduce((sum, s) => sum + s.falseAlarms, 0) + (live?.falseAlarms ?? 0) };
  }).sort((a, b) => b.points - a.points);
  const events = room.events.filter(e => e.seq > after && (!self || e.event.type === 'joined' || !('playerId' in e.event) || e.event.playerId === null || e.event.playerId === self.id));
  return {
    code: room.code, capacity: room.capacity, phase: room.phase, round: Math.min(room.rounds.length + 1, 3), canStart: canStartRoom(room, now),
    players: room.players.map(p => ({ id: p.id, name: p.name, animal: p.animal, publicBio: p.character?.publicBio ?? '', ready: p.strategyRound === room.rounds.length + 1, connected: now - p.lastSeen < 15000 })),
    standings, rounds: room.rounds, events, cursor: room.nextSeq - 1, error: room.error,
    ...(self ? { self: { id: self.id, name: self.name, ready: self.strategyRound === room.rounds.length + 1 } } : {}),
  };
}
