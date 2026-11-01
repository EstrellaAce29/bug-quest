'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BUG_LABELS, type ArenaEvent, type ArenaPlayer, type ArenaFinding, type ArenaCheck, type RoundSummary } from '@/lib/arena';
import styles from './arena.module.css';

type Game = { id: string; players: ArenaPlayer[]; rounds: RoundSummary[] };
type Turn = { runId?: string; logs: string[]; checks: ArenaCheck[]; findings: ArenaFinding[]; points?: number; caught?: number; fixed?: number; falseAlarms?: number };
const blankTurn = (): Turn => ({ logs: [], checks: [], findings: [] });
const initial = [
  { id: 'player-1', name: 'Baseline', strategy: 'Compare extracted rows against loaded matches.' },
  { id: 'player-2', name: 'Rally', strategy: 'Check standings totals and look for duplicate matches.' },
];

export default function Arena() {
  const [players, setPlayers] = useState<ArenaPlayer[]>(initial);
  const [game, setGame] = useState<Game | null>(null);
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Record<string, Turn>>({});
  const [active, setActive] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const id = sessionStorage.getItem('bug-quest-arena');
    if (id) void request({ action: 'resume', gameId: id }).then(data => { setGame(data.game); setPlayers(data.game.players); if (data.recovery) setMessage('An interrupted round may need Recover reset.'); }).catch(() => sessionStorage.removeItem('bug-quest-arena'));
    return () => controller.current?.abort();
  }, []);

  async function request(body: unknown, signal?: AbortSignal) {
    const response = await fetch('/api/arena', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'Arena request failed.'); }
    return response.json();
  }
  function update(index: number, key: 'name' | 'strategy', value: string) { setPlayers(current => current.map((p, i) => i === index ? { ...p, [key]: value } : p)); }
  async function create() {
    setBusy(true); setError(''); setMessage('');
    try { const data = await request({ action: 'create', players }); setGame(data.game); setPlayers(data.game.players); sessionStorage.setItem('bug-quest-arena', data.game.id); setTurns({}); setLogs([]); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not create game.'); }
    finally { setBusy(false); }
  }
  function receive(event: ArenaEvent) {
    if (event.type === 'log') {
      if (event.playerId) setTurns(current => { const turn = current[event.playerId!] ?? blankTurn(); return { ...current, [event.playerId!]: { ...turn, logs: [...turn.logs.slice(-149), event.message] } }; });
      else setLogs(current => [...current.slice(-99), event.message]);
    } else if (event.type === 'turn') { setActive(event.playerId); setTurns(current => ({ ...current, [event.playerId]: { ...(current[event.playerId] ?? blankTurn()), runId: event.runId } })); }
    else if (event.type === 'plan') setTurns(current => ({ ...current, [event.playerId]: { ...(current[event.playerId] ?? blankTurn()), checks: event.checks } }));
    else if (event.type === 'finding') setTurns(current => { const turn = current[event.playerId] ?? blankTurn(); return { ...current, [event.playerId]: { ...turn, findings: [...turn.findings, event.finding] } }; });
    else if (event.type === 'score') setTurns(current => ({ ...current, [event.score.playerId]: { ...(current[event.score.playerId] ?? blankTurn()), ...event.score } }));
    else if (event.type === 'summary') { setGame(current => current ? { ...current, rounds: [...current.rounds.filter(r => r.round !== event.summary.round), event.summary] } : current); setActive(null); }
    else if (event.type === 'error') setError(event.message + ' Round scores were not saved.');
  }
  async function runRound() {
    if (!game || controller.current) return;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(''); setMessage(''); setTurns({}); setLogs([]);
    let completed = false;
    try {
      const response = await fetch('/api/arena', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'round', gameId: game.id, round: game.rounds.length + 1, players }), signal: abort.signal });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'Could not start round.'); }
      if (!response.body) throw new Error('Live stream unavailable.');
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      while (true) {
        const { value, done } = await reader.read(); buffer += decoder.decode(value, { stream: !done });
        let end: number;
        while ((end = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (line.trim()) { const event: ArenaEvent = JSON.parse(line); if (event.type === 'summary' || event.type === 'error') completed = true; receive(event); } }
        if (done) break;
      }
      if (!completed) throw new Error('Round stream ended early. Use Recover reset before retrying.');
    } catch (e) { setError(abort.signal.aborted ? 'Round stopped. The server is resetting faults; wait for cleanup or use Recover reset.' : e instanceof Error ? e.message : 'Round failed.'); }
    finally { controller.current = null; setBusy(false); setActive(null); }
  }
  async function recover() {
    setBusy(true); setError('');
    try { const data = await request({ action: 'recover' }); setMessage(`Both faults are off. Verified clean run: ${data.runId}`); }
    catch (e) { setError(e instanceof Error ? e.message : 'Recovery failed.'); }
    finally { setBusy(false); }
  }
  const round = (game?.rounds.length ?? 0) + 1;
  const finished = round > 3;
  const leaderboard = players.map(p => {
    const totals = (game?.rounds ?? []).flatMap(r => r.scores).filter(s => s.playerId === p.id);
    return { ...p, points: totals.reduce((n, s) => n + s.points, 0), caught: totals.reduce((n, s) => n + s.caught.length, 0), fixed: totals.reduce((n, s) => n + s.fixed.length, 0), alarms: totals.reduce((n, s) => n + s.falseAlarms, 0) };
  }).sort((a, b) => b.points - a.points);
  const valid = players.every(p => p.name.trim() && p.strategy.trim()) && new Set(players.map(p => p.name.trim().toLowerCase())).size === players.length;
  return <div className={styles.shell}>
    <header className={styles.header}><Link href="/arena" className={styles.brand}>⌘ <span>BUG QUEST <b>ARENA</b></span></Link><div><Link href="/quest">Solo quest ↗</Link><Link href="/pipelines">Monitor ↗</Link></div></header>
    <main className={styles.main}>
      <section className={styles.hero}><div><p className={styles.eyebrow}>COACH. INVESTIGATE. OUTSCORE.</p><h1>Bug Quest Arena<span>Find what green pipelines hide.</span></h1><p>2–4 agents. Three rounds. Real tennis data, hidden faults, and strategies that get sharper.</p></div><div className={styles.rules}><span><b>+20</b> bug caught</span><span><b>+15</b> verified repair</span><span><b>−5</b> false alarm</span></div></section>
      <div className={styles.progress} aria-label="Game progress">{[1, 2, 3].map(n => <span key={n} className={(game?.rounds.length ?? 0) >= n ? styles.complete : n === round ? styles.current : ''}>0{n} <b>Round {n}</b>{(game?.rounds.length ?? 0) >= n ? ' ✓' : n === round && game ? ' · Up next' : ''}</span>)}</div>
      {error && <div role="alert" className={styles.error}>{error}</div>}{message && <p role="status" className={styles.notice}>{message}</p>}
      <div className={styles.columns}><section className={styles.panel}><div className={styles.panelHeading}><div><p className={styles.eyebrow}>{game ? finished ? 'FINAL WHISTLE' : 'THE COACHING BENCH' : 'BUILD YOUR ROSTER'}</p><h2>{finished ? 'Game complete' : game ? `Prepare for round ${round}` : 'Meet your agents'}</h2></div>{!game && <label>Players <select aria-label="Number of players" disabled={busy} value={players.length} onChange={e => setPlayers(current => Array.from({ length: Number(e.target.value) }, (_, i) => current[i] ?? { id: `player-${i + 1}`, name: '', strategy: '' }))}>{[2, 3, 4].map(n => <option key={n}>{n}</option>)}</select></label>}</div>
        {finished ? <div className={styles.winner}><span>🏆</span><h3>{leaderboard.filter(p => p.points === leaderboard[0].points).map(p => p.name).join(' & ')}</h3><p>{leaderboard[0].points} points · {leaderboard.filter(p => p.points === leaderboard[0].points).length > 1 ? 'Shared victory' : 'Arena champion'}</p></div> : players.map((player, index) => <article className={styles.playerSetup} key={player.id}><span className={styles.number}>0{index + 1}</span><div><label htmlFor={`${player.id}-name`}>Agent name</label><input id={`${player.id}-name`} value={player.name} maxLength={60} disabled={busy || !!game} onChange={e => update(index, 'name', e.target.value)} placeholder={`Agent ${index + 1}`} /><label htmlFor={`${player.id}-strategy`}>Coaching strategy</label><textarea id={`${player.id}-strategy`} value={player.strategy} maxLength={1000} rows={2} disabled={busy} onChange={e => update(index, 'strategy', e.target.value)} placeholder="Compare row counts, inspect standings, check for duplicates…" /></div></article>)}
        <div className={styles.actions}>{!game ? <button className={styles.primary} disabled={busy || !valid} onClick={create}>Create game →</button> : !finished ? <button className={styles.primary} disabled={busy || !valid} onClick={runRound}>{busy ? 'Round in progress…' : `Start round ${round} →`}</button> : <button className={styles.primary} disabled={busy} onClick={() => { setGame(null); setTurns({}); sessionStorage.removeItem('bug-quest-arena'); }}>New game →</button>}{controller.current && <button onClick={() => controller.current?.abort()}>Stop & reset</button>}<button disabled={busy} onClick={recover}>Recover reset</button></div>
        <p className={styles.help}>Players take turns on identical hidden faults. Edit coaching between rounds. Repairs are isolated to fresh runs; the original demo source stays planted. Uses model API usage and Kane credits.</p></section>
        <aside className={`${styles.panel} ${styles.leaderboard}`}><p className={styles.eyebrow}>THE STANDINGS</p><h2>Leaderboard</h2><p className={styles.help}>Completed rounds only. False claims cost points; ordinary passing checks do not.</p>{leaderboard.map((p, i) => <div key={p.id} className={styles.leader}><span>{String(i + 1).padStart(2, '0')}</span><div><strong>{p.name || `Agent ${i + 1}`}</strong><small>{p.caught} caught · {p.fixed} repaired · {p.alarms} false alarms</small></div><b>{p.points}<small>PTS</small></b></div>)}<div className={styles.secret}>◈ <strong>{busy ? 'Faults stay hidden until the reveal.' : 'A fresh challenge every round.'}</strong><p>One or two faults. Every agent gets a fair shot. Both faults reset off after the round.</p></div></aside></div>
      {(busy || Object.keys(turns).length > 0) && <section className={styles.live}><div className={styles.panelHeading}><h2>At the investigation desk</h2><span aria-live="polite">{active ? `${players.find(p => p.id === active)?.name} is playing` : busy ? 'Preparing / resetting' : 'Round ended'}</span></div><div className={styles.turnGrid}>{players.map(p => { const turn = turns[p.id] ?? blankTurn(); return <article key={p.id} className={`${styles.panel} ${active === p.id ? styles.active : ''}`}><h3>{p.name} <span>{turn.points === undefined ? active === p.id ? 'LIVE' : 'WAITING' : `${turn.points} PTS`}</span></h3>{turn.runId && <small className={styles.runId}>{turn.runId}</small>}{turn.checks.map(c => <p className={styles.check} key={c.invariant}><b>{c.title}</b><span>{c.objective}</span></p>)}{turn.findings.map((f, i) => <div key={i} className={f.error ? styles.error : f.reportedBug ? styles.flag : styles.pass}><b>{f.error ? 'ERROR · no score' : f.reportedBug ? 'FLAGGED' : 'PASS'}</b><p>{f.summary}</p>{f.testUrl && <a href={f.testUrl} target="_blank" rel="noopener noreferrer">Kane evidence ↗</a>}</div>)}<div role="log" aria-label={`${p.name} live log`} className={styles.log}>{turn.logs.length ? turn.logs.map((line, i) => <p key={i}>› {line}</p>) : <p>Waiting for this agent’s turn.</p>}</div></article>; })}</div></section>}
      {logs.length > 0 && <section className={`${styles.panel} ${styles.roundLog}`}><h3>Round operations</h3><div role="log" aria-label="Round operations" className={styles.log}>{logs.map((line, i) => <p key={i}>› {line}</p>)}</div></section>}
      {(game?.rounds ?? []).map(summary => <section key={summary.round} className={`${styles.panel} ${styles.summary}`}><p className={styles.eyebrow}>ROUND {summary.round} · THE REVEAL</p><h2>Here’s what was hiding.</h2><ul>{summary.planted.map(bug => <li key={bug}><strong>{BUG_LABELS[bug]}</strong><p>Caught by: {summary.scores.filter(s => s.caught.includes(bug)).map(s => players.find(p => p.id === s.playerId)?.name).join(', ') || 'Nobody this round'}</p></li>)}</ul><p className={styles.help}>Both faults reset off. Clean verification: <code>{summary.resetRunId}</code></p></section>)}
      <footer className={styles.footer}>BUG QUEST ARENA <span>Green tasks. Better questions.</span></footer>
    </main>
  </div>;
}
