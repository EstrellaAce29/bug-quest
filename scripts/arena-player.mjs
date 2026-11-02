#!/usr/bin/env node
import { characterWizard } from './arena-character.mjs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export function controllerOptions(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') return { help: true };
    if (args[i] === '--new') { options.new = true; continue; }
    if (!['--code', '--name', '--url', '--session', '--character'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Use --code CODE --name "Agent" [--url http://127.0.0.1:3000] [--session file] [--character saved-name] [--new].');
    options[args[i].slice(2)] = args[++i];
  }
  if (options.character && (options.new || options.name)) throw new Error('Use --character to reuse a profile, or --name with --new to create one.');
  const url = new URL(options.url || 'http://127.0.0.1:3000');
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.protocol !== 'http:' || url.port !== '3000' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Use the local Bug Quest server at http://127.0.0.1:3000.');
  return { ...options, url: url.origin };
}
export async function arenaRequest(url, body, signal) {
  const response = await fetch(`${url}/api/arena`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || `Bug Quest HTTP ${response.status}`); error.httpStatus = response.status; throw error; }
  return data;
}
export function terminalText(value) {
  // Agent names and model/browser logs are data, never terminal escape sequences.
  return String(value).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}
export function playerEventText(envelope, playerId) {
  const e = envelope.event;
  if (e.type === 'joined') return `${e.name}${e.animal ? ` the ${e.animal}` : ''} joined${e.publicBio ? ` · ${e.publicBio}` : ''}`;
  if (e.type === 'speech' && e.playerId === playerId) return `Your agent: “${e.text}”`;
  if (e.type === 'award' && e.playerId === playerId) return `${e.amount > 0 ? '+' : ''}${e.amount} · ${e.reason === 'catch' ? 'bug caught' : e.reason === 'fix' ? 'verified fix' : 'false alarm'}`;
  if (e.type === 'turn' && e.playerId === playerId) return `Your turn · ${e.runId}`;
  if (e.type === 'plan' && e.playerId === playerId) return `Precise checks:\n${e.checks.map(c => `  • ${c.title}: ${c.objective}`).join('\n')}`;
  if (e.type === 'finding' && e.playerId === playerId) return `${e.finding.error ? 'ERROR' : e.finding.reportedBug ? 'FLAGGED' : 'PASS'} · ${e.finding.summary}${e.finding.testUrl ? `\nKane evidence: ${e.finding.testUrl}` : ''}`;
  if (e.type === 'log' && (e.playerId === playerId || e.playerId === null)) return e.message;
  if (e.type === 'score' && e.score.playerId === playerId) return `Turn score: ${e.score.points} points · ${e.score.caught} caught · ${e.score.fixed} verified fixes · ${e.score.falseAlarms} false alarms (pending round reset)`;
  if (e.type === 'error') return `ROUND VOID: ${e.message}`;
  return null;
}

export async function runController(args = process.argv.slice(2)) {
  const options = controllerOptions(args);
  if (options.help) { stdout.write('npm run arena:player -- --code CODE --name "Agent"\nCreate a character in five steps, or add --character NAME to reuse one. --new rewrites a saved character.\nOne terminal per player. Keep it open for all three rounds. Ctrl+C disconnects without stopping the game.\n'); return; }
  const stop = new AbortController();
  let heartbeat;
  const rl = createInterface({ input: stdin, output: stdout });
  // Keep one input iterator alive so piped controller checks do not lose lines.
  const lines = rl[Symbol.asyncIterator]();
  const print = message => stdout.write(terminalText(message) + '\n');
  const ask = async label => { stdout.write(label); const line = await lines.next(); if (line.done) throw new Error('Controller input closed. Re-run this command to reconnect.'); return line.value.trim(); };
  const quit = () => { stop.abort(); rl.close(); };
  process.once('SIGINT', quit); process.once('SIGTERM', quit);
  rl.on('SIGINT', quit);
  try {
    const profile = await characterWizard({ ask, print, options, green: text => {
      const safe = terminalText(text);
      stdout.write(stdout.isTTY && !process.env.NO_COLOR ? `\x1b[32m${safe}\x1b[0m\n` : safe + '\n');
    } });
    const name = profile.name;
    const character = { animal: profile.animal, traits: profile.traits, privateCharacter: profile.privateCharacter, publicBio: profile.publicBio };
    const code = (options.code || await ask('Game code? ')).trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code)) throw new Error('Enter the six-character game code shown in the browser.');
    const sessionFile = path.resolve(options.session || path.join('.arena', `${code}-${createHash('sha256').update(name).digest('hex').slice(0, 20)}.json`));
    let token; let playerId;
    try {
      const saved = JSON.parse(await readFile(sessionFile, 'utf8'));
      if (saved.code === code && saved.name === name && saved.url === options.url && typeof saved.token === 'string') {
        const data = await arenaRequest(options.url, { action: 'state', code, playerToken: saved.token, after: 0 }, stop.signal);
        token = saved.token; playerId = data.room.self.id;
      }
    } catch (error) { if (error.httpStatus && error.httpStatus !== 404) throw error; }
    if (!token) {
      const joined = await arenaRequest(options.url, { action: 'join', code, name, character }, stop.signal);
      token = joined.playerToken; playerId = joined.playerId;
      await mkdir(path.dirname(sessionFile), { recursive: true });
      await writeFile(sessionFile, JSON.stringify({ code, name, url: options.url, token }), { mode: 0o600 });
    }
    print(`\nBUG QUEST · ${code}\nJoined as ${name}. Watch ${options.url}/arena?code=${code}\nYour controller reconnects when you repeat this command. Ctrl+C leaves play running.\n`);
    let cursor = 0; let failures = 0; let lastPhase = ''; const printedRounds = new Set();
    // Coaching is interactive: keep presence alive without consuming events while
    // the main loop waits at the prompt. The next poll still prints each result.
    let heartbeatBusy = false;
    heartbeat = setInterval(() => {
      if (heartbeatBusy || stop.signal.aborted) return;
      heartbeatBusy = true;
      arenaRequest(options.url, { action: 'state', code, playerToken: token, after: cursor }, stop.signal)
        .catch(() => {}).finally(() => { heartbeatBusy = false; });
    }, 4000);
    while (!stop.signal.aborted) {
      let room;
      try { ({ room } = await arenaRequest(options.url, { action: 'state', code, playerToken: token, after: cursor }, stop.signal)); failures = 0; }
      catch (error) {
        if (stop.signal.aborted) break;
        if (error.httpStatus) throw error;
        if (++failures > 5) throw new Error('Bug Quest server is unavailable. Repeat this command after the server returns.');
        print('Connection interrupted; retrying…'); await delay(2000, undefined, { signal: stop.signal }); continue;
      }
      for (const event of room.events) { const text = playerEventText(event, playerId); if (text) print(text); }
      cursor = room.cursor;
      for (const summary of room.rounds) {
        if (printedRounds.has(summary.round)) continue;
        printedRounds.add(summary.round);
        const score = summary.scores.find(s => s.playerId === playerId);
        print(`\nROUND ${summary.round} REVEAL · ${summary.planted.join(', ')}\nYour confirmed result: ${score?.points ?? 0} points · ${score?.caught.length ?? 0} bugs · ${score?.fixed.length ?? 0} fixes · ${score?.falseAlarms ?? 0} false alarms\nFaults reset off · ${summary.resetRunId}\n`);
      }
      if (room.phase === 'finished') {
        const mine = room.standings.find(s => s.playerId === playerId);
        print(`GAME COMPLETE · ${mine.points} total points · rank ${1 + room.standings.filter(s => s.points > mine.points).length}/${room.players.length}`); break;
      }
      if (`${room.round}:${room.phase}` !== lastPhase) { lastPhase = `${room.round}:${room.phase}`; print(`Round ${room.round} · ${room.phase}${room.phase === 'recovery' ? ' — the host must recover the reset' : ''}`); }
      if (['lobby', 'coaching'].includes(room.phase) && !room.self.ready) {
        const strategy = await ask(`Round ${room.round} — Your strategy? `);
        try { await arenaRequest(options.url, { action: 'strategy', code, playerToken: token, round: room.round, strategy }, stop.signal); print('Strategy locked in. Waiting for the browser host to start the round…'); }
        catch (error) { if (error.httpStatus === 400) print(error.message); else throw error; }
      }
      await delay(1000, undefined, { signal: stop.signal });
    }
  } catch (error) { if (!stop.signal.aborted) throw error; }
  finally { clearInterval(heartbeat); stop.abort(); rl.close(); process.removeListener('SIGINT', quit); process.removeListener('SIGTERM', quit); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runController().catch(error => { console.error(terminalText(error.message)); process.exitCode = 1; });
}
