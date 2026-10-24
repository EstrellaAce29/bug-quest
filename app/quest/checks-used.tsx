import snapshot from '@/data/quest-session.json';
import styles from './quest.module.css';

export default function ChecksUsed() {
  const totals = snapshot.totals;
  const metrics = [
    ['Kane runs', totals.kaneRuns],
    ['Checks generated*', totals.checksGenerated],
    ['Bugs found', totals.bugsFound],
    ['Fixes verified', totals.fixesVerified],
    ['Credits used', totals.creditsUsed === null ? 'Unknown' : totals.creditsUsed.toFixed(2)],
  ];
  return <section className={styles.checksCard} aria-labelledby="checks-title">
    <div className={styles.checksHeading}><h2 id="checks-title">Checks used</h2><span>Recorded session totals</span></div>
    <ul className={styles.keyChecks}>
      <li>Check that enrollment_pipeline has a completed last run.</li>
      <li>Verify load rows equal extract rows (1,000).</li>
      <li>Verify all tasks processed the same rows when the DAG shows Success.</li>
    </ul>
    <p className={styles.checkWarning}>The last rule also includes the sensor’s zero rows. After the load fix, row equality passed but this broader rule failed.</p>
    <dl className={styles.sessionMetrics}>{metrics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <p className={styles.metricNote}>From completed runs in this Codex session. *Checks generated counts assertion records in the saved results, including repeats; value extractions are excluded. Unfinished runs are excluded. Fixes verified requires a passing after-fix run.</p>
    <details className={styles.checkDetails}><summary>All recorded assertion checks and source reports</summary>
      {snapshot.runs.map((run, index) => <div key={run.sessionId} className={styles.runChecks}>
        <a href={run.url} target="_blank" rel="noopener noreferrer">Run {index + 1} · {run.status.toUpperCase()} · code {run.resultCode} ↗</a>
        <ul>{run.assertions.map(check => <li key={check.id}>{check.condition || check.description}</li>)}</ul>
      </div>)}
    </details>
  </section>;
}
