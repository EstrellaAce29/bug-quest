'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import runs from '@/data/quest-runs.json';
import styles from './quest.module.css';
import ChecksUsed from './checks-used';
import TheFix from './the-fix';

export default function Quest() {
  const [agent, setAgent] = useState('BugSniffer');
  const [instruction, setInstruction] = useState('Check the pipeline ran');
  const [entry, setEntry] = useState({ agent: 'BugSniffer', instruction: '' });
  const [stage, setStage] = useState(-1);
  useEffect(() => {
    if (stage < 0 || stage >= 5) return;
    const timer = setTimeout(() => setStage(current => current + 1), 1500);
    return () => clearTimeout(timer);
  }, [stage]);
  const running = stage >= 0 && stage < 5;
  const found = stage >= 3;
  const verified = stage === 5 && runs.find(run => run.id === 'fixed')?.status === 'PASS';
  const points = (found ? 20 : 0) + (verified ? 15 : 0);
  const messages = [
    `${entry.agent} is expanding your instruction...`,
    'Running basic check...',
    'Running precise check...',
    'Fixing bug...',
    'Re-verifying with Kane...',
  ];
  function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running || !agent.trim() || !instruction.trim()) return;
    setEntry({ agent: agent.trim(), instruction: instruction.trim() });
    setStage(0);
  }
  return <div className={styles.shell}>
    <header className={styles.header}><Link href="/quest" className={styles.logo}><span>⌘</span>Bug Quest<i /></Link><div className={styles.headerRight}><span className={styles.recordedTag}><i />Recorded demo</span><Link href="/pipelines">Pipeline Monitor <span aria-hidden="true">↗</span></Link></div></header>
    <main className={styles.main}>
      <div className={styles.intro}><span className={styles.eyebrow}>SMALL INSTRUCTION. SHARPER CHECKS.</span><h1>Bug Quest<span>.</span></h1><p>A short instruction says PASS on a broken pipeline. Bug Quest writes the checks that catch it, fixes the code, and has Kane verify the fix.</p></div>
      <div className={styles.layout}>
        <div className={styles.leftColumn}>
          <section className={styles.formCard} aria-labelledby="launch-title"><div className={styles.cardHeading}><span className={styles.stepNumber}>01</span><div><h2 id="launch-title">Send your agent on a quest</h2><p>One instruction. Follow the evidence.</p></div></div>
            <form onSubmit={start}>
              <label htmlFor="agent-name">Name your agent</label><input id="agent-name" name="agent" value={agent} onChange={event => setAgent(event.target.value)} placeholder="BugSniffer" maxLength={80} required disabled={running} />
              <label htmlFor="instruction">Your instruction</label><textarea id="instruction" name="instruction" value={instruction} onChange={event => setInstruction(event.target.value)} placeholder="Check the pipeline ran" maxLength={1000} rows={3} required disabled={running} />
              <button type="submit" className={styles.runButton} disabled={running || !agent.trim() || !instruction.trim()}><span aria-hidden="true">{running ? '◌' : '▷'}</span>{running ? 'Quest in progress' : stage === 5 ? 'Run Quest again' : 'Run Quest'}<span aria-hidden="true">→</span></button>
              <p className={styles.replayNote}>Replays the recorded enrollment_pipeline checks below. It does not launch new Kane runs or edit code.</p>
            </form>
          </section>
          <section className={styles.progressCard} aria-labelledby="progress-title"><div className={styles.progressHeading}><h2 id="progress-title">Quest activity</h2><span>{stage < 0 ? 'Waiting to start' : stage === 5 ? 'Replay complete' : 'Replaying'}</span></div>
            <div className={styles.progressBar} role="progressbar" aria-label="Recorded quest replay" aria-valuenow={stage < 0 ? 0 : stage * 20} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${stage < 0 ? 0 : stage * 20}%` }} /></div>
            <div role="log" aria-live="polite" aria-relevant="additions" className={styles.activity}>
              {stage < 0 ? <p className={styles.idle}>Your agent’s next adventure starts here.</p> : <><p className={styles.submittedInstruction}>“{entry.instruction}”</p>{messages.slice(0, Math.min(stage + 1, 5)).map((message, index) => <div key={index} className={index === stage ? styles.activeMessage : styles.finishedMessage}><span aria-hidden="true">{index === stage ? '◌' : '✓'}</span>{message}</div>)}{stage === 5 && <p className={styles.complete}>{verified ? 'Quest complete. Bug found, fixed, and verified.' : 'Replay complete. See the recorded verification result below.'}</p>}</>}
            </div>
          </section>
        </div>
        <aside className={styles.scoreCard} aria-labelledby="score-title"><div className={styles.scoreTop}><span className={styles.eyebrow}>THE SCOREBOARD</span><span aria-hidden="true">⚑</span></div><div className={styles.agentAvatar} aria-hidden="true">{(stage < 0 ? agent : entry.agent).trim().slice(0, 2).toUpperCase() || 'BQ'}</div><h2 id="score-title">{stage < 0 ? agent.trim() || 'Your agent' : entry.agent}</h2><p className={styles.agentSubtitle}>Silent bug hunter</p><div className={styles.scoreTotal}>{points}<span>POINTS</span></div><div className={styles.scoreLine}><div><strong>Bugs found</strong><small>Silent row mismatch</small></div><span className={found ? styles.earned : ''}>{found ? '+20' : '0'}</span></div><div className={styles.scoreLine}><div><strong>Fixed &amp; verified</strong><small>Confirmed by Kane</small></div><span className={verified ? styles.earned : ''}>{verified ? '+15' : '0'}</span></div><p className={styles.scoreNote}>Points reflect this recorded replay.<br />A green status alone earns nothing.</p></aside>
      </div>
      <section className={styles.resultsCard} aria-labelledby="results-title"><div className={styles.resultsHeading}><div><span className={styles.eyebrow}>THE EVIDENCE</span><h2 id="results-title">Recorded Kane runs</h2><p>Same pipeline. Different instructions. Very different answers.</p></div><span className={styles.runCount}>4 runs</span></div><div className={styles.tableWrap}><table><thead><tr><th scope="col">CHECK</th><th scope="col">RESULT</th><th scope="col">WHAT IT FOUND</th><th scope="col">EVIDENCE</th></tr></thead><tbody>{runs.map((run, index) => <tr key={run.id} className={run.id === 'precise' ? styles.bugRow : run.id === 'fixed' ? styles.fixedRow : ''}><td><span className={styles.rowNumber}>{String(index + 1).padStart(2, '0')}</span><div><strong>{run.label}</strong><small>{run.summary}</small></div></td><td><span className={run.status === 'FAIL' ? styles.fail : run.status === 'PASS' ? styles.pass : styles.pending}>{run.status}</span>{run.resultCode !== null && <small className={styles.resultCode}>code {run.resultCode}</small>}</td><td><span className={run.outcome === 'Missed bug' ? styles.missed : styles.outcome}>{run.outcome === 'Missed bug' ? '↳ ' : run.id === 'fixed' && run.status !== 'PASS' ? '! ' : '✓ '}{run.outcome}</span></td><td>{run.url ? <a href={run.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${run.label} in Test Manager`}>Test Manager <span aria-hidden="true">↗</span></a> : <span className={styles.pending}>Awaiting report</span>}</td></tr>)}</tbody></table></div><div className={styles.resultsFooter}><span>Real recorded results · enrollment_pipeline</span><span>rowMismatchBug stays enabled during verification</span></div></section>
      <TheFix />
      <ChecksUsed />
      <footer className={styles.footer}><span>Bug Quest <b>/</b> Find what green dashboards miss.</span><Link href="/pipelines">Inspect the pipeline →</Link></footer>
    </main>
  </div>;
}
