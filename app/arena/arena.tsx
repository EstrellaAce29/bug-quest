'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BUG_LABELS } from '@/lib/arena';
import type { RoomEvent, RoomView } from '@/lib/arena-room';
import Hunter, { HUNTERS } from './hunter';
import styles from './arena.module.css';

type Connection = { code: string; hostToken?: string };
const SESSION = 'bug-quest-arena-host-v2';
async function request(body: unknown, signal?: AbortSignal) {
  const response = await fetch('/api/arena', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Arena request failed.');
  return data;
}

export default function Arena() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const [capacity, setCapacity] = useState(2);
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [connected, setConnected] = useState(false);
  const cursor = useRef(0);

  useEffect(() => {
    try {
      const saved: Connection | null = JSON.parse(sessionStorage.getItem(SESSION) || 'null');
      const code = new URL(window.location.href).searchParams.get('code')?.toUpperCase() || saved?.code;
      if (code) setConnection({ code, ...(saved?.code === code ? { hostToken: saved.hostToken } : {}) });
    } catch { sessionStorage.removeItem(SESSION); }
  }, []);
  useEffect(() => {
    if (!connection) return;
    let disposed = false; let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController(); cursor.current = 0; setEvents([]); setConnected(false);
    async function poll() {
      try {
        const data = await request({ action: 'state', code: connection!.code, after: cursor.current }, controller.signal);
        if (disposed) return;
        setRoom(data.room); setRecovery(data.recovery); setConnected(true);
        const fresh: RoomEvent[] = data.room.events.filter((e: RoomEvent) => e.seq > cursor.current);
        cursor.current = data.room.cursor;
        if (fresh.length) setEvents(current => [...current, ...fresh].slice(-1000));
      } catch (e) { if (!disposed) { setConnected(false); setError(e instanceof Error ? e.message : 'Connection lost; retrying.'); } }
      finally { if (!disposed) timer = setTimeout(poll, 850); }
    }
    void poll();
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, [connection]);

  async function create() {
    setBusy(true); setError(''); setMessage('');
    try {
      const data = await request({ action: 'create', capacity });
      const session = { code: data.room.code, hostToken: data.hostToken };
      sessionStorage.setItem(SESSION, JSON.stringify(session));
      setRoom(data.room); setConnection(session);
      window.history.replaceState(null, '', `/arena?code=${session.code}`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create lobby.'); }
    finally { setBusy(false); }
  }
  async function control(action: 'start' | 'stop' | 'recover') {
    if (!connection || !room) return;
    setBusy(true); setError(''); setMessage('');
    try {
      // A verified reset can take longer than ordinary polling requests.
      const response = await fetch('/api/arena', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...connection, round: room.round }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not control this round.');
      if (data.room) setRoom(data.room);
      if (data.runId) setMessage(`Both faults are off. Clean verification: ${data.runId}`);
      if (data.stopping) setMessage('Stopping this round; the server is resetting faults before reopening coaching.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Arena action failed.'); }
    finally { setBusy(false); }
  }
  function newLobby() {
    sessionStorage.removeItem(SESSION); setConnection(null); setRoom(null); setEvents([]); setError(''); setMessage(''); cursor.current = 0;
    window.history.replaceState(null, '', '/arena');
  }
  const playing = room?.phase === 'running' || room?.phase === 'resetting';
  const players = room?.players ?? [];
  const slots = room?.capacity ?? capacity;
  const now = Date.now();
  const recent = events.filter(e => now - e.at < 5000);
  const lastRound = events.at(-1)?.round ?? room?.round ?? 1;
  const activeTurn = events.filter(e => e.round === lastRound && e.event.type === 'turn').at(-1);
  const activeId = room?.phase === 'running' && activeTurn?.event.type === 'turn' ? activeTurn.event.playerId : null;
  const phaseLabel = !room ? connection ? 'CONNECTING' : 'READY TO HOST' : room.phase === 'lobby' ? 'WAITING FOR HUNTERS' : room.phase === 'coaching' ? 'COACHING BREAK' : room.phase === 'running' ? 'HUNT IN PROGRESS' : room.phase === 'resetting' ? 'RESETTING FAULTS' : room.phase === 'recovery' ? 'RESET NEEDS RECOVERY' : 'GAME COMPLETE';

  return <div className={styles.shell}>
    <header className={styles.header}><Link href="/arena" className={styles.brand}><span className={styles.brandIcon}>⌘</span> BUG QUEST <b>ARENA</b></Link><div><Link href="/quest">Solo quest ↗</Link><Link href="/pipelines">Monitor ↗</Link><span className={styles.connection}><i className={connected ? styles.online : ''} />{connection ? connected ? 'LIVE' : 'RECONNECTING' : 'LOCAL PLAY'}</span></div></header>
    <main className={styles.main}>
      <section className={styles.hero}><div><p className={styles.eyebrow}>COACH YOUR BOT. CATCH THE BUGS.</p><h1>Small hunters.<br /><span>Big discoveries.</span></h1><p>A three-round showdown inside a real data pipeline.<br />The tasks are green. Your agents know better.</p></div><div className={styles.scoreRules}><span><b>+20</b> BUG CAUGHT</span><span><b>+15</b> VERIFIED FIX</span><span><b>−5</b> FALSE ALARM</span></div></section>
      {error && <div role="alert" className={styles.error}>{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
      {message && <p role="status" className={styles.notice}>{message}</p>}
      <section className={styles.lobby} aria-label="Game lobby">
        <div><p className={styles.eyebrow}>{connection ? 'YOUR LOBBY' : 'HOST A SHOWDOWN'}</p>{connection ? <><strong className={styles.joinCode} aria-label="Game join code">{connection.code}</strong><p>{players.length}/{slots} hunters joined · {players.filter(p => p.ready).length} strategies ready</p></> : <><h2>Bring your terminal. Pick your hunter.</h2><p>One shared screen. One terminal per player. No sign-up.</p></>}</div>
        <div className={styles.lobbyControls}>{!connection ? <><label>Player slots <select aria-label="Player slots" value={capacity} onChange={e => setCapacity(Number(e.target.value))}>{[2, 3, 4].map(n => <option key={n}>{n}</option>)}</select></label><button className={styles.primary} onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create lobby →'}</button></> : <><code>npm run arena:player -- --code {connection.code} --name &quot;Your agent&quot;</code><small>Run this in each player’s terminal from the project folder.</small></>}</div>
      </section>
      {players.some(player => player.publicBio) && <section className={styles.bioGrid} aria-label="Public character bios" aria-live="polite">{players.map(player => player.publicBio && <article key={player.id}><h2>{player.name} joined the hunt</h2><p>{player.publicBio}</p></article>)}</section>}
      <div className={styles.gameLayout}>
        <section className={styles.stagePanel} aria-label="Hunter arena stage">
          <div className={styles.stageHeader}><span><i />{phaseLabel}</span><div aria-label="Round progress">{[1, 2, 3].map(n => <b key={n} className={(room?.rounds.length ?? 0) >= n ? styles.roundDone : n === (room?.round ?? 1) ? styles.roundCurrent : ''}>{(room?.rounds.length ?? 0) >= n ? '✓' : n}</b>)}</div></div>
          <div className={styles.stage}><div className={styles.moon} /><span className={styles.stageWord}>BUG HUNTERS CLUB</span><div className={styles.hunters} style={{ gridTemplateColumns: `repeat(${slots}, minmax(0, 1fr))` }}>
            {Array.from({ length: slots }, (_, i) => {
              const player = players[i]; const palette = HUNTERS[i];
              const awards = player ? recent.filter(e => e.event.type === 'award' && e.event.playerId === player.id).slice(-4) : [];
              const latest = awards.at(-1);
              const miss = player ? recent.filter(e => e.event.type === 'score' && e.event.score.playerId === player.id && e.event.score.caught === 0).at(-1) : null;
              const negative = latest?.event.type === 'award' && latest.event.amount < 0;
              const reaction = latest ? negative ? styles.shake : styles.bounce : miss ? styles.shake : '';
              const standing = room?.standings.find(s => s.playerId === player?.id);
              const speech = player ? events.filter(e => e.event.type === 'speech' && e.event.playerId === player.id && e.round === lastRound).at(-1) : null;
              return <article key={player?.id ?? `slot-${i}`} className={`${styles.hunter} ${!player ? styles.empty : ''} ${activeId === player?.id ? styles.activeHunter : ''}`} style={{ '--hunter-color': palette.body } as React.CSSProperties}>
                {speech?.event.type === 'speech' && <div key={speech.seq} className={styles.speechBubble} role="status">{speech.event.text}</div>}
                <div className={styles.popupZone} aria-live="polite">{awards.map((a, index) => a.event.type === 'award' && <span key={a.seq} className={`${styles.popup} ${a.event.amount < 0 ? styles.negative : ''}`} style={{ animationDelay: `${index * .45}s` }}>{a.event.amount > 0 ? '+' : '−'}{Math.abs(a.event.amount)}<small>{a.event.reason === 'catch' ? 'BUG CAUGHT!' : a.event.reason === 'fix' ? 'FIX VERIFIED!' : 'FALSE ALARM'}</small></span>)}</div>
                <div className={styles.spriteFloat}><div key={latest?.seq ?? miss?.seq ?? 'idle'} className={reaction}><Hunter index={i} happy={!!latest && !negative} /></div></div>
                <div className={styles.platform} /><strong>{player?.name || 'Waiting for a hunter…'}</strong><span className={styles.characterName}>{palette.name}</span><span className={styles.playerStatus}>{!player ? 'OPEN SLOT' : activeId === player.id ? 'ON THE HUNT' : room?.phase === 'finished' ? `${standing?.points ?? 0} PTS` : playing ? 'IN THE ARENA' : player.ready ? player.connected ? '✓ STRATEGY READY' : 'CONTROLLER OFFLINE' : 'COACHING IN TERMINAL'}</span>
              </article>;
            })}
          </div><div className={styles.floor} /><span className={styles.stageCaption}>{playing ? 'The bugs are hidden. Let the hunt begin.' : room?.phase === 'finished' ? 'Great hunters ask better questions.' : 'Your next great strategy starts in the terminal.'}</span></div>
          <div className={styles.stageFooter}><p>{room?.phase === 'finished' ? `🏆 ${room.standings.filter(p => p.points === room.standings[0]?.points).map(p => p.name).join(' & ')} wins!` : playing ? `Round ${room?.round} · results are streaming to each controller` : 'Start when at least two hunters have submitted coaching.'}</p><div>{connection?.hostToken && room && (playing ? <button onClick={() => control('stop')} disabled={busy || room.phase === 'resetting'}>Stop & reset</button> : room.phase === 'finished' ? <button className={styles.primary} onClick={newLobby}>New game →</button> : <button className={styles.primary} disabled={busy || !room.canStart || !connected || recovery} onClick={() => control('start')}>{busy ? 'Starting…' : `Start round ${room.round} →`}</button>)}{connection && !connection.hostToken && <span className={styles.spectator}>Shared screen · host controls rounds</span>}</div></div>
        </section>
        <aside className={styles.leaderboard} aria-label="Animated leaderboard"><p className={styles.eyebrow}>THE RACE TO THE TOP</p><h2>Leaderboard<span>↗</span></h2><p className={styles.help}>Live scores · confirmed after the round resets</p><div className={styles.rankList} style={{ height: `${Math.max(players.length, 2) * 85}px` }}>{room?.standings.map((score, rank) => {
          const index = players.findIndex(p => p.id === score.playerId);
          return <div key={score.playerId} className={styles.rank} style={{ transform: `translateY(${rank * 85}px)`, '--hunter-color': HUNTERS[index].body } as React.CSSProperties}><span className={styles.rankNumber}>{rank + 1}</span><div className={styles.miniHunter}><Hunter index={index} /></div><div className={styles.rankName}><strong>{score.name}</strong><small>{score.caught} caught · {score.fixed} fixed · {score.falseAlarms} alarms</small></div><b>{score.points}<small>PTS</small></b></div>;
        })}{players.length === 0 && <p className={styles.waitingBoard}>The podium is empty.<br />Your hunters are on their way.</p>}</div><div className={styles.secret}>◈ <strong>Same faults. Fair play.</strong><p>Every hunter gets a fresh run with identical hidden bugs. The round reveal tells all.</p></div></aside>
      </div>
      {connection && <div className={styles.hostTools}><span>{recovery || room?.phase === 'recovery' ? 'An interrupted round needs a verified reset.' : 'Three rounds. Both faults reset off after each round.'}</span>{connection.hostToken && <button disabled={busy || playing} onClick={() => control('recover')}>Recover reset</button>}{!playing && <button onClick={newLobby}>Leave this screen</button>}</div>}
      {players.length > 0 && <section className={styles.logsSection}><div className={styles.sectionHeading}><p className={styles.eyebrow}>FROM THE FIELD</p><h2>Hunter transmissions</h2></div><div className={styles.logGrid}>{players.map((p, i) => {
        const own = events.filter(e => e.round === lastRound && 'playerId' in e.event && e.event.playerId === p.id);
        return <article key={p.id} className={styles.logCard}><h3><i style={{ background: HUNTERS[i].body }} />{p.name}<span>{p.connected ? 'CONNECTED' : 'OFFLINE'}</span></h3><div role="log" aria-label={`${p.name} live log`} className={styles.terminal}>{own.length ? own.slice(-16).map(e => <p key={e.seq}>{e.event.type === 'speech' ? `“${e.event.text}”` : e.event.type === 'joined' ? e.event.publicBio : e.event.type === 'log' ? e.event.message : e.event.type === 'finding' ? `${e.event.finding.reportedBug ? '⚑' : '✓'} ${e.event.finding.summary}` : e.event.type === 'plan' ? e.event.checks.map(c => c.title).join(' · ') : e.event.type === 'award' ? `${e.event.amount > 0 ? '+' : ''}${e.event.amount} ${e.event.reason.replace('_', ' ')}` : e.event.type === 'turn' ? `Investigating ${e.event.runId}` : ''}{e.event.type === 'finding' && e.event.finding.testUrl && <><br /><a href={e.event.finding.testUrl} target="_blank" rel="noopener noreferrer">Kane evidence ↗</a></>}</p>) : <p>Waiting for a strategy from this controller…</p>}</div></article>;
      })}</div></section>}
      {room?.error && <div role="alert" className={styles.error}>{room.error} Round scores were not saved.</div>}
      {room?.rounds.map(summary => <section key={summary.round} className={styles.reveal}><p className={styles.eyebrow}>ROUND {summary.round} · THE BIG REVEAL</p><h2>Here’s what was hiding.</h2><div className={styles.revealBugs}>{summary.planted.map(bug => <div key={bug}><span>⚑</span><strong>{BUG_LABELS[bug]}</strong><p>Caught by {summary.scores.filter(s => s.caught.includes(bug)).map(s => players.find(p => p.id === s.playerId)?.name).join(', ') || 'nobody this round'}</p></div>)}</div><div className={styles.roundScores}>{summary.scores.map(s => <p key={s.playerId}><strong>{players.find(p => p.id === s.playerId)?.name}</strong><span>{s.points > 0 ? '+' : ''}{s.points} PTS</span><small>{s.caught.length} caught · {s.fixed.length} fixed · {s.falseAlarms} false alarms</small></p>)}</div><p className={styles.help}>✓ Both faults reset off · <code>{summary.resetRunId}</code></p></section>)}
      <footer className={styles.footer}><span>ORIGINAL HUNTERS. REAL PIPELINES.</span><span>OpenAI / Ollama + Kane · local play</span></footer>
    </main>
  </div>;
}
