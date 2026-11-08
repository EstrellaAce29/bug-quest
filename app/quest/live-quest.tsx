'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import RecordedQuest from './recorded-quest';
import type { ExpandedObjective, LiveEvent, LiveResult, FixReport } from '@/lib/quest-contract';
import styles from './quest.module.css';
import Animal from '../play/animal';
import { animalForName, type StageAgent, type StageView } from '@/lib/stage';
import { ANIMALS } from '@/lib/play-character.mjs';
import { QUEST_TIMEOUTS, withQuestTimeout } from '@/lib/quest-timeout';
import { consumeQuestStream } from '@/lib/quest-stream';

export default function LiveQuest() {
  const [step, setStep] = useState<'name' | 'instruction'>('name');
  const [target, setTarget] = useState<'simulated' | 'airflow'>('airflow');
  const [agent, setAgent] = useState('');
  const [instruction, setInstruction] = useState('');
  const [activeAgent, setActiveAgent] = useState('');
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [plan, setPlan] = useState<ExpandedObjective[]>([]);
  const [results, setResults] = useState<LiveResult[]>([]);
  const [points, setPoints] = useState(0);
  const [bugsFound, setBugsFound] = useState(0);
  const [falseAlarms, setFalseAlarms] = useState(0);
  const [fixesVerified, setFixesVerified] = useState(0);
  const [repairs, setRepairs] = useState<FixReport[]>([]);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const terminal = useRef<HTMLDivElement | null>(null);
  const [stageAgent, setStageAgent] = useState<Pick<StageAgent, 'animal' | 'color'> | null>(null);
  const displayedName = (logs.length || busy ? activeAgent : agent).trim();
  useEffect(() => {
    const controller = new AbortController();
    const key = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
    setStageAgent(null);
    async function refresh() {
      try {
        const response = await fetch('/api/stage', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'state' }), signal: controller.signal,
        });
        if (!response.ok) return;
        const view: StageView = await response.json();
        if (!controller.signal.aborted) setStageAgent(view.agents.find(entry => key(entry.name) === key(displayedName)) ?? null);
      } catch { /* The quest stream reports connection failures. */ }
    }
    void refresh();
    return () => controller.abort();
  }, [displayedName]);
  const avatar = stageAgent ?? animalForName(displayedName);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (terminal.current) terminal.current.scrollTop = terminal.current.scrollHeight;
  }, [logs]);

  async function start() {
    if (abort.current || step !== 'instruction' || !agent.trim() || !instruction.trim()) return;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true); setActiveAgent(agent.trim());
    setLogs([`${agent.trim()}: Starting quest…`, 'Connecting to the quest server (15-second limit)…']); setResults([]); setPlan([]); setError(null); setPoints(0); setFalseAlarms(0); setBugsFound(0); setFixesVerified(0); setRepairs([]); setCompleted(false);
    let finished = false;
    function receive(event: LiveEvent) {
      switch (event.type) {
        case 'log': setLogs(current => [...current.slice(-299), event.message]); break;
        case 'plan': setPlan(event.objectives); break;
        case 'result':
          setResults(current => [...current.filter(result => result.id !== event.result.id), event.result]);
          setFalseAlarms(event.falseAlarms ?? 0); setPoints(event.points); setBugsFound(event.bugsFound); setFixesVerified(event.fixesVerified ?? 0); break;
        case 'fix':
          setRepairs(current => [...current.filter(report => report.checkId !== event.report.checkId), event.report]);
          setFalseAlarms(event.falseAlarms ?? 0); setPoints(event.points); setBugsFound(event.bugsFound); setFixesVerified(event.fixesVerified); break;
        case 'done': finished = true; setCompleted(true); setFalseAlarms(event.falseAlarms ?? 0); setPoints(event.points); setBugsFound(event.bugsFound); setFixesVerified(event.fixesVerified ?? 0); break;
        case 'error': finished = true; setError(event.message); setLogs(current => [...current, `${agent.trim()}: ${event.message}`]); break;
      }
    }
    try {
      const response = await withQuestTimeout('Connection to the quest server', QUEST_TIMEOUTS.connect, controller.signal, () => fetch('/api/quest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent, instruction: instruction.trim(), target, confirmed: true }), signal: controller.signal,
      }));
      if (!response.ok) {
        const body = await withQuestTimeout('Quest server error response', QUEST_TIMEOUTS.connect, controller.signal, () => response.json());
        throw new Error(typeof body.error === 'string' ? body.error : `Quest request failed (HTTP ${response.status}).`);
      }
      if (!response.body) throw new Error('The server did not return a live stream.');
      const animal = response.headers.get('X-Bug-Quest-Animal');
      const color = Number(response.headers.get('X-Bug-Quest-Color'));
      if (ANIMALS.includes(animal as StageAgent['animal']) && Number.isInteger(color) && color >= 0 && color < 4) {
        setStageAgent({ animal: animal as StageAgent['animal'], color });
      }
      await consumeQuestStream(response.body, controller.signal, receive);
      if (!finished) throw new Error('The connection ended before the quest completed. Partial results are shown below.');
    } catch (cause) {
      const message = controller.signal.aborted ? 'Quest cancelled. Partial results are preserved.'
        : cause instanceof Error ? cause.message : 'Could not run the live quest.';
      controller.abort();
      setError(message); setLogs(current => [...current, `${agent.trim()}: ${message}`]);
    } finally {
      abort.current = null; setBusy(false);
    }
  }

  const checks = [
    { id: 0, title: 'Basic instruction', objective: instruction.trim() || 'Waiting for your check' },
    ...plan.map((item, index) => ({ id: index + 1, title: item.title, objective: item.objective })),
  ];
  return <div className={styles.shell}>
    <header className={styles.header}><Link href="/quest" className={styles.logo}><span>⌘</span>Bug Quest<i /></Link><div className={styles.headerRight}><span className={styles.liveTag}>Live mode</span><Link href="/stage" target="_blank" rel="noopener noreferrer">Open stage ↗</Link><Link href="/pipelines">Pipeline Monitor ↗</Link></div></header>
    <main className={styles.main}>
      <div className={styles.intro}><span className={styles.eyebrow}>REAL CHECKS. REAL EVIDENCE.</span><h1>Bug Quest<span>.</span></h1><p>Name your agent, enter what to check, then click Run. No quest starts until you confirm both inputs.</p></div>
      <div className={styles.layout}>
        <div className={styles.leftColumn}>
          <section className={styles.formCard} aria-labelledby="live-launch-title"><div className={styles.cardHeading}><span className={styles.stepNumber}>{step === 'name' ? '01' : '02'}</span><div><h2 id="live-launch-title">{step === 'name' ? 'Name your agent' : 'What should your agent check?'}</h2><p>{step === 'name' ? 'Enter a name to continue. No quest will start.' : 'Describe your check in your own words, then click Run.'}</p></div></div>
            <form onSubmit={event => { event.preventDefault(); if (step === 'name' && agent.trim()) setStep('instruction'); }}>
              {step === 'name' ? <>
                <label htmlFor="live-agent">Name your agent</label><input id="live-agent" value={agent} onChange={event => setAgent(event.target.value)} maxLength={80} required disabled={busy} placeholder="Your agent’s name" />
                <button className={styles.runButton} type="submit" disabled={busy || !agent.trim()}>Continue →</button>
              </> : <>
                <p>Agent: <strong>{agent.trim()}</strong> <button className={styles.editName} type="button" disabled={busy} onClick={() => setStep('name')}>Edit name</button></p>
                <label htmlFor="live-instruction">What should your agent check?</label><textarea id="live-instruction" value={instruction} onChange={event => setInstruction(event.target.value)} maxLength={1000} rows={4} required disabled={busy} placeholder="Describe the behavior or data your agent should verify" />
                <label htmlFor="live-target">Target</label><select id="live-target" value={target} onChange={event => setTarget(event.target.value as 'simulated' | 'airflow')} disabled={busy}><option value="simulated">Simulated monitor</option><option value="airflow">Real Airflow</option></select>
                <p className={styles.replayNote}>Browser checks stay headless. Progress appears in the log below.</p>
                <button className={styles.runButton} type="button" onClick={() => void start()} disabled={busy || !agent.trim() || !instruction.trim()}><span aria-hidden="true">{busy ? '◌' : '▷'}</span>{busy ? 'Quest in progress' : 'Run'}<span aria-hidden="true">→</span></button>
              </>}
              {busy && <p className={styles.runStatus} role="status">{logs.at(-1)}</p>}
              {busy && <button className={styles.cancelButton} type="button" onClick={() => abort.current?.abort()}>Cancel</button>}
              <p className={styles.replayNote}>Uses OpenAI API usage and Kane credits. Auto-fix can edit and commit {target === 'airflow' ? 'only the tennis DAG after a new Airflow run passes Kane + SQL' : 'lib/pipeline.ts after Kane verifies it'}. Up to three attempts; config/bugs.json is never edited.</p>
            </form>
          </section>
        </div>
        <aside className={styles.scoreCard} aria-labelledby="live-score-title"><div className={styles.scoreTop}><span className={styles.eyebrow}>LIVE SCOREBOARD</span><span aria-hidden="true">⚑</span></div><div className={styles.agentAvatar} role="img" aria-label={`${displayedName || "Your agent"}: ${avatar.animal}`}><Animal animal={avatar.animal} index={avatar.color} name={displayedName} /></div><h2 id="live-score-title">{logs.length ? activeAgent : agent.trim() || 'Your agent'}</h2><p className={styles.agentSubtitle}>Silent bug hunter</p><div className={styles.scoreTotal} data-negative={points < 0}>{points}<span>POINTS</span></div><div className={styles.scoreLine}><div><strong>Silent bugs caught</strong><small>+20 per distinct invariant</small></div><span className={bugsFound ? styles.earned : ''}>{bugsFound}</span></div><div className={styles.scoreLine}><div><strong>Fixes verified</strong><small>+15 after precise + basic pass</small></div><span className={fixesVerified ? styles.earned : ''}>{fixesVerified}</span></div><div className={styles.scoreLine}><div><strong>False alarms</strong><small>−5 per disproven bug claim</small></div><span>{falseAlarms}</span></div><p className={styles.scoreNote}>A silent bug counts when the basic check passes and a precise check confirms an application bug.<br />Repeated checks of the same bug count once.</p></aside>
      </div>
      <section className={styles.terminalCard} aria-labelledby="live-log-title"><div className={styles.terminalHeading}><h2 id="live-log-title">Live quest log</h2><span>{busy ? <button type="button" className={styles.cancelButton} onClick={() => abort.current?.abort()}>Cancel</button> : repairs.some(report => report.status === 'escalated') ? 'Escalated to human' : completed ? 'Complete' : logs.length ? 'Stopped' : 'Ready'}</span></div><div ref={terminal} className={styles.terminal} role="log" aria-live="polite" aria-relevant="additions">{logs.length ? logs.map((line, index) => <div key={index}><span aria-hidden="true">› </span>{line}</div>) : <p>Your agent’s progress will stream here.</p>}</div></section>
      {error && <div className={styles.liveError} role="alert">{error}</div>}
      <section className={styles.resultsCard} aria-labelledby="live-results-title"><div className={styles.resultsHeading}><div><span className={styles.eyebrow}>THIS QUEST</span><h2 id="live-results-title">Live results</h2><p>Results come from Kane browser runs and, for Real Airflow, SQL warehouse checks.</p></div><span className={styles.runCount}>{results.length} completed</span></div><div className={styles.tableWrap}><table><thead><tr><th scope="col">CHECK / OBJECTIVE</th><th scope="col">RESULT</th><th scope="col">RESULT CODE / SOURCE</th><th scope="col">TEST MANAGER</th></tr></thead><tbody>{checks.map(check => {
        const result = results.find(item => item.id === check.id);
        const repair = repairs.find(report => report.checkId === check.id);
        return <Fragment key={check.id}><tr><td><span className={styles.rowNumber}>{String(check.id + 1).padStart(2, '0')}</span><div><strong>{check.title}</strong><small>{result?.objective ?? check.objective}</small>{result && <small>{result.summary}</small>}</div></td><td><span className={!result ? styles.pending : result.status === 'passed' ? styles.pass : styles.fail}>{!result ? busy ? 'Waiting' : 'Not run' : result.status === 'passed' ? 'PASS' : result.status === 'failed' ? 'FAIL' : 'ERROR'}</span></td><td className="mono">{result?.resultCode ?? '—'}{result?.source && <small>{result.source}</small>}</td><td>{result?.testUrl ? <a href={result.testUrl} target="_blank" rel="noopener noreferrer">Test Manager ↗</a> : '—'}</td></tr>{repair && <tr><td colSpan={4} className={styles.repairCell}><div className={styles.repairHeading}><strong>{repair.status === 'fixed' ? 'Fixed and verified' : repair.status === 'escalated' ? 'Escalated to human' : 'Auto-fix in progress'}</strong><span>{repair.attempts.length} / 3 attempts</span></div><p>{repair.message}</p>{repair.checkpoint && <p>Checkpoint <code>{repair.checkpoint.slice(0, 7)}</code>{repair.commit && <> · auto-fix commit <code>{repair.commit.slice(0, 7)}</code></>}</p>}{repair.diff.length > 0 && <div className={styles.fixDiff}><pre className={styles.repairDiff}><code>{repair.diff.map((line, index) => <span className={line.kind === 'removed' ? styles.removedLine : line.kind === 'added' ? styles.addedLine : styles.contextLine} key={index}>{line.kind === 'removed' ? '− ' : line.kind === 'added' ? '+ ' : '  '}{line.text}{'\n'}</span>)}</code></pre></div>}{repair.afterResult?.testUrl && <p><a href={repair.afterResult.testUrl} target="_blank" rel="noopener noreferrer">After-fix Test Manager report ({repair.afterResult.status.toUpperCase()}) ↗</a></p>}{repair.basicResult?.testUrl && <p><a href={repair.basicResult.testUrl} target="_blank" rel="noopener noreferrer">Basic recheck ({repair.basicResult.status.toUpperCase()}) ↗</a></p>}<details><summary>Attempt evidence</summary>{repair.attempts.map(attempt => <div key={attempt.number} className={styles.attemptEvidence}>Attempt {attempt.number}: {attempt.error || attempt.description || 'Working'}{attempt.precise?.testUrl && <> · <a href={attempt.precise.testUrl} target="_blank" rel="noopener noreferrer">precise {attempt.precise.status} ↗</a></>}{attempt.basic?.testUrl && <> · <a href={attempt.basic.testUrl} target="_blank" rel="noopener noreferrer">basic {attempt.basic.status} ↗</a></>}</div>)}</details></td></tr>}</Fragment>;
      })}</tbody></table></div></section>
      <details className={styles.pastRuns}><summary>Past runs</summary><p>Recorded hackathon evidence. Opening this section runs nothing.</p><RecordedQuest /></details>
      <footer className={styles.footer}><span>Bug Quest <b>/</b> Live browser verification</span><Link href="/pipelines">Inspect the pipeline →</Link></footer>
    </main>
  </div>;
}
