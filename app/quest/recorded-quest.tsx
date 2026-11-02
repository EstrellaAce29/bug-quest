import runs from '@/data/quest-runs.json';
import styles from './quest.module.css';
import ChecksUsed from './checks-used';
import TheFix from './the-fix';

// Read-only hackathon evidence. Opening this section never starts a replay or run.
export default function RecordedQuest() {
  return <div>
      <section className={styles.resultsCard} aria-labelledby="results-title"><div className={styles.resultsHeading}><div><span className={styles.eyebrow}>THE EVIDENCE</span><h2 id="results-title">Recorded Kane runs</h2><p>Same pipeline. Different instructions. Very different answers.</p></div><span className={styles.runCount}>4 runs</span></div><div className={styles.tableWrap}><table><thead><tr><th scope="col">CHECK</th><th scope="col">RESULT</th><th scope="col">WHAT IT FOUND</th><th scope="col">EVIDENCE</th></tr></thead><tbody>{runs.map((run, index) => <tr key={run.id} className={run.id === 'precise' ? styles.bugRow : run.id === 'fixed' ? styles.fixedRow : ''}><td><span className={styles.rowNumber}>{String(index + 1).padStart(2, '0')}</span><div><strong>{run.label}</strong><small>{run.summary}</small></div></td><td><span className={run.status === 'FAIL' ? styles.fail : run.status === 'PASS' ? styles.pass : styles.pending}>{run.status}</span>{run.resultCode !== null && <small className={styles.resultCode}>code {run.resultCode}</small>}</td><td><span className={run.outcome === 'Missed bug' ? styles.missed : styles.outcome}>{run.outcome === 'Missed bug' ? '↳ ' : run.id === 'fixed' && run.status !== 'PASS' ? '! ' : '✓ '}{run.outcome}</span></td><td>{run.url ? <a href={run.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${run.label} in Test Manager`}>Test Manager <span aria-hidden="true">↗</span></a> : <span className={styles.pending}>Awaiting report</span>}</td></tr>)}</tbody></table></div><div className={styles.resultsFooter}><span>Real recorded results · enrollment_pipeline</span><span>rowMismatchBug stays enabled during verification</span></div></section>
      <TheFix />
      <ChecksUsed />
  </div>;
}
