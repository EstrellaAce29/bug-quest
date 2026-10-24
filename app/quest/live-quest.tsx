'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { ExpandedObjective, LiveEvent, LiveResult } from '@/lib/quest-contract';
import styles from './quest.module.css';

export default function LiveQuest({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) {
  const [agent, setAgent] = useState('Winter');
  const [instruction, setInstruction] = useState('Check the pipeline ran');
  const [activeAgent, setActiveAgent] = useState('Winter');
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [plan, setPlan] = useState<ExpandedObjective[]>([]);
  const [results, setResults] = useState<LiveResult[]>([]);
  const [points, setPoints] = useState(0);
  const [bugsFound, setBugsFound] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const terminal = useRef<HTMLDivElement | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (terminal.current) terminal.current.scrollTop = terminal.current.scrollHeight;
  }, [logs]);

  async function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (abort.current || !agent.trim() || !instruction.trim()) return;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true); onBusyChange(true); setActiveAgent(agent.trim());
    setLogs([]); setResults([]); setPlan([]); setError(null); setPoints(0); setBugsFound(0);
    let finished = false;
    function receive(event: LiveEvent) {
      switch (event.type) {
        case 'log': setLogs(current => [...current.slice(-299), event.message]); break;
        case 'plan': setPlan(event.objectives); break;
        case 'result':
          setResults(current => [...current.filter(result => result.id !== event.result.id), event.result]);
          setPoints(event.points); setBugsFound(event.bugsFound); break;
        case 'done': finished = true; setPoints(event.points); setBugsFound(event.bugsFound); break;
        case 'error': finished = true; setError(event.message); setLogs(current => [...current, `${agent.trim()}: ${event.message}`]); break;
      }
    }
    try {
      const response = await fetch('/api/quest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent, instruction }), signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(typeof body.error === 'string' ? body.error : `Quest request failed (HTTP ${response.status}).`);
      }
      if (!response.body) throw new Error('The server did not return a live stream.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      while (true) {
        const { value, done } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        let boundary: number;
        while ((boundary = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, boundary); pending = pending.slice(boundary + 1);
          if (line.trim()) receive(JSON.parse(line) as LiveEvent);
        }
        if (done) break;
      }
      if (pending.trim()) receive(JSON.parse(pending) as LiveEvent);
      if (!finished) throw new Error('The connection ended before the quest completed. Partial results are shown below.');
    } catch (cause) {
      const message = controller.signal.aborted ? 'Quest cancelled. Partial results are preserved.'
        : cause instanceof Error ? cause.message : 'Could not run the live quest.';
      setError(message); setLogs(current => [...current, `${agent.trim()}: ${message}`]);
    } finally {
      abort.current = null; setBusy(false); onBusyChange(false);
    }
  }

  const checks = [
    { id: 0, title: 'Basic instruction', objective: instruction },
    ...plan.map((item, index) => ({ id: index + 1, title: item.title, objective: item.objective })),
  ];
  return <div className={styles.shell}>
    <header className={styles.header}><Link href="/quest" className={styles.logo}><span>⌘</span>Bug Quest<i /></Link><div className={styles.headerRight}><span className={styles.liveTag}>Live mode</span><Link href="/pipelines">Pipeline Monitor ↗</Link></div></header>
    <main className={styles.main}>
      <div className={styles.intro}><span className={styles.eyebrow}>REAL CHECKS. REAL EVIDENCE.</span><h1>Bug Quest<span>.</span></h1><p>Give your agent an instruction. OpenAI turns it into precise checks, and Kane runs them against the Pipeline Monitor.</p></div>
      <div className={styles.layout}>
        <div className={styles.leftColumn}>
          <section className={styles.formCard} aria-labelledby="live-launch-title"><div className={styles.cardHeading}><span className={styles.stepNumber}>01</span><div><h2 id="live-launch-title">Run a live quest</h2><p>Your original check, followed by two or three precise checks.</p></div></div>
            <form onSubmit={start}>
              <label htmlFor="live-agent">Name your agent</label><input id="live-agent" value={agent} onChange={event => setAgent(event.target.value)} maxLength={80} required disabled={busy} placeholder="Winter" />
              <label htmlFor="live-instruction">Your instruction</label><textarea id="live-instruction" value={instruction} onChange={event => setInstruction(event.target.value)} maxLength={1000} rows={3} required disabled={busy} placeholder="Check the pipeline ran" />
              <button className={styles.runButton} type="submit" disabled={busy || !agent.trim() || !instruction.trim()}><span aria-hidden="true">{busy ? '◌' : '▷'}</span>{busy ? 'Quest in progress' : 'Run Quest'}<span aria-hidden="true">→</span></button>
              {busy && <button className={styles.cancelButton} type="button" onClick={() => abort.current?.abort()}>Stop quest</button>}
              <p className={styles.replayNote}>Uses OpenAI API usage and Kane credits. Chrome opens on this machine. Live mode runs checks; it does not edit or fix code.</p>
            </form>
          </section>
        </div>
        <aside className={styles.scoreCard} aria-labelledby="live-score-title"><div className={styles.scoreTop}><span className={styles.eyebrow}>LIVE SCOREBOARD</span><span aria-hidden="true">⚑</span></div><div className={styles.agentAvatar}>{(logs.length ? activeAgent : agent).trim().slice(0, 2).toUpperCase() || 'BQ'}</div><h2 id="live-score-title">{logs.length ? activeAgent : agent.trim() || 'Your agent'}</h2><p className={styles.agentSubtitle}>Silent bug hunter</p><div className={styles.scoreTotal}>{points}<span>POINTS</span></div><div className={styles.scoreLine}><div><strong>Silent bugs caught</strong><small>+20 per distinct invariant</small></div><span className={bugsFound ? styles.earned : ''}>{bugsFound}</span></div><p className={styles.scoreNote}>A silent bug counts when the basic check passes and a precise check confirms an application bug.<br />Repeated checks of the same bug count once.</p></aside>
      </div>
      <section className={styles.terminalCard} aria-labelledby="live-log-title"><div className={styles.terminalHeading}><h2 id="live-log-title">Live quest log</h2><span>{busy ? 'Running' : logs.length ? 'Stopped' : 'Ready'}</span></div><div ref={terminal} className={styles.terminal} role="log" aria-live="polite" aria-relevant="additions">{logs.length ? logs.map((line, index) => <div key={index}><span aria-hidden="true">› </span>{line}</div>) : <p>Your agent’s progress will stream here.</p>}</div></section>
      {error && <div className={styles.liveError} role="alert">{error}</div>}
      <section className={styles.resultsCard} aria-labelledby="live-results-title"><div className={styles.resultsHeading}><div><span className={styles.eyebrow}>THIS QUEST</span><h2 id="live-results-title">Live results</h2><p>Results come from each completed Kane run.</p></div><span className={styles.runCount}>{results.length} completed</span></div><div className={styles.tableWrap}><table><thead><tr><th scope="col">CHECK / OBJECTIVE</th><th scope="col">RESULT</th><th scope="col">RESULT CODE</th><th scope="col">TEST MANAGER</th></tr></thead><tbody>{checks.map(check => {
        const result = results.find(item => item.id === check.id);
        return <tr key={check.id}><td><span className={styles.rowNumber}>{String(check.id + 1).padStart(2, '0')}</span><div><strong>{check.title}</strong><small>{result?.objective ?? check.objective}</small>{result && <small>{result.summary}</small>}</div></td><td><span className={!result ? styles.pending : result.status === 'passed' ? styles.pass : styles.fail}>{!result ? busy ? 'Waiting' : 'Not run' : result.status === 'passed' ? 'PASS' : result.status === 'failed' ? 'FAIL' : 'ERROR'}</span></td><td className="mono">{result?.resultCode ?? '—'}</td><td>{result?.testUrl ? <a href={result.testUrl} target="_blank" rel="noopener noreferrer">Test Manager ↗</a> : '—'}</td></tr>;
      })}</tbody></table></div></section>
      <footer className={styles.footer}><span>Bug Quest <b>/</b> Live browser verification</span><Link href="/pipelines">Inspect the pipeline →</Link></footer>
    </main>
  </div>;
}
