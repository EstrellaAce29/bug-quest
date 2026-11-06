'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Animal, { PLAYER_COLORS } from '../play/animal';
import type { StageView, StageAward } from '@/lib/stage';
import styles from './stage.module.css';

async function request(action: 'state' | 'reset', after: number, signal?: AbortSignal): Promise<StageView> {
  const r = await fetch('/api/stage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, after }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Stage unavailable.');
  return data;
}
export default function Stage() {
  const [view, setView] = useState<StageView | null>(null);
  const [awards, setAwards] = useState<StageAward[]>([]);
  const [now, setNow] = useState(Date.now());
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [resetting, setResetting] = useState(false);
  const cursor = useRef(0); const generation = useRef(-1);
  function receive(data: StageView) {
    if (data.generation < generation.current || data.cursor < cursor.current) return;
    const changed = data.generation !== generation.current;
    const fresh = data.awards.filter(a => a.seq > cursor.current);
    generation.current = data.generation; cursor.current = data.cursor;
    setView(data); setConnected(true); setError('');
    setAwards(current => changed ? fresh : [...current, ...fresh].slice(-100));
  }
  useEffect(() => {
    const abort = new AbortController(); let disposed = false; let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try { const data = await request('state', cursor.current, abort.signal); if (!disposed) receive(data); }
      catch { if (!disposed) { setConnected(false); setError('Connection lost. Reconnecting…'); } }
      finally { if (!disposed) timer = setTimeout(poll, 850); }
    }
    void poll(); const clock = setInterval(() => setNow(Date.now()), 250);
    return () => { disposed = true; abort.abort(); clearTimeout(timer); clearInterval(clock); };
  }, []);
  async function reset() {
    setResetting(true);
    try { receive(await request('reset', cursor.current)); }
    catch { setError('Could not reset the leaderboard. Try again.'); }
    finally { setResetting(false); }
  }
  const agents = view?.agents ?? [];
  return <div className={styles.shell}>
    <header className={styles.header}><Link href="/stage" className={styles.brand}>✦ BUG QUEST</Link><div><Link href="/quest" target="_blank" rel="noopener noreferrer">Open controls ↗</Link><span className={connected ? styles.online : styles.offline}>{connected ? '● LIVE' : '○ CONNECTING'}</span></div></header>
    <main className={styles.main}>
      <section className={styles.intro}><div><p className={styles.eyebrow}>THE SHOW SCREEN</p><h1>Small paws. Big proof.</h1><p>Start a quest on the control screen. Your agent joins the stage live.</p></div><div className={styles.rules} aria-label="Scoring rules"><span><b>+20</b> bug caught</span><span><b>+15</b> fix verified</span><span><b>−5</b> false alarm</span></div></section>
      {error && <p role="status" className={styles.error}>{error}</p>}
      <div className={styles.layout}>
        <section className={styles.stagePanel} aria-label="Live animal stage"><div className={styles.stageHeading}><span>THE EVIDENCE TRAIL</span><span>{agents.length} agent{agents.length === 1 ? '' : 's'}</span></div>
          <div className={styles.stage}>
            {!agents.length && <div className={styles.empty}><span>✧</span><h2>The stage is waiting.</h2><p>Name an agent on <Link href="/quest" target="_blank" rel="noopener noreferrer">the control screen ↗</Link>, then click Run Quest.<br />Opening this screen starts no checks.</p></div>}
            <div className={styles.characters}>{agents.map(agent => {
              const recent = awards.filter(a => a.agentId === agent.id && now - a.at < 6000);
              const last = recent.at(-1); const thinking = agent.phase === 'thinking' || agent.phase === 'fixing';
              return <article className={styles.character} key={agent.id} style={{ '--accent': PLAYER_COLORS[agent.color].body } as React.CSSProperties}>
                <div className={styles.speech} role="status">{agent.speech}{thinking && <span className={styles.thinking}><i /><i /><i />{agent.phase === 'fixing' ? 'Fixing…' : 'Thinking…'}</span>}</div>
                <div className={styles.motion}><div className={styles.popups} aria-live="polite">{recent.map((a, i) => <span key={a.seq} className={`${styles.popup} ${a.amount < 0 ? styles.negative : ''}`} style={{ animationDelay: `${i * .3}s` }}>{a.amount > 0 ? '+' : '−'}{Math.abs(a.amount)}<small>{a.amount === 20 ? 'BUG CAUGHT' : a.amount === 15 ? 'FIX VERIFIED' : 'FALSE ALARM'}</small></span>)}</div>
                  <div className={styles.join}><div key={last?.seq ?? 'idle'} className={last ? last.amount > 0 ? styles.happy : styles.shake : ''}><div className={styles.float}><Animal name={agent.name} animal={agent.animal} index={agent.color} happy={!!last && last.amount > 0} thinking={thinking} /></div></div></div><div className={styles.platform} /></div>
                <h2>{agent.name}</h2><p>{agent.animal} · {thinking ? agent.phase === 'fixing' ? 'repairing' : 'checking' : agent.phase === 'stopped' ? 'needs attention' : 'quest complete'}</p>
              </article>;
            })}</div>
          </div><footer className={styles.stageFooter}>Original animals. Real checks. Every point needs evidence.</footer>
        </section>
        <aside className={styles.board} aria-label="Points leaderboard"><p className={styles.eyebrow}>THE SESSION LEADERBOARD</p><h2>Proof earns points.</h2><p className={styles.hint}>Every agent stays until you reset or restart the server.</p>
          <div className={styles.rankList} style={{ height: `${Math.max(1, agents.length) * 88}px` }}>{view?.standings.map((agent, rank) => <div className={styles.rank} key={agent.id} style={{ transform: `translateY(${rank * 88}px)` }}><span>{rank + 1}</span><div className={styles.mini}><Animal animal={agent.animal} index={agent.color} /></div><div className={styles.rankName}><strong>{agent.name}</strong><small>{agent.bugs} caught · {agent.fixes} fixed · {agent.falseAlarms} alarms</small></div><b data-negative={agent.points < 0}>{agent.points}<small>PTS</small></b></div>)}{!agents.length && <p className={styles.noScores}>No agents yet. First quest, first footprint.</p>}</div>
          <button onClick={reset} disabled={resetting || !connected || !agents.length}>{resetting ? 'Resetting…' : 'Reset leaderboard'}</button><p className={styles.hint}>Clears the stage and scores. Running quests continue on their control screen.</p>
        </aside>
      </div>
    </main>
  </div>;
}
