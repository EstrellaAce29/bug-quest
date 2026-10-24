import styles from './quest.module.css';

// Exact changed code lines from fix commit 04dd7350cb5b0d29b1fe8083676a084ad56b43ef.
const before = 'const loadBatch = bugs.rowMismatchBug ? sourceRows.slice(0, Math.ceil(sourceRows.length / 2)) : sourceRows;';
const after = 'const loadBatch = sourceRows;';

export default function TheFix() {
  return <section className={styles.fixCard} aria-labelledby="fix-title">
    <div className={styles.checksHeading}><h2 id="fix-title">The fix</h2><span>lib/pipeline.ts</span></div>
    <p className={styles.fixDescription}>The load step cut the data in half (an accidental page-size limit).</p>
    <div className={styles.fixDiff}>
      <pre className={styles.removedLine}><code><span className={styles.diffLabel}>Before · removed</span>{`− ${before}`}</code></pre>
      <pre className={styles.addedLine}><code><span className={styles.diffLabel}>After · added</span>{`+ ${after}`}</code></pre>
    </div>
    <p className={styles.fixCommit}>Fix commit <code title="04dd7350cb5b0d29b1fe8083676a084ad56b43ef">04dd735</code></p>
    <p className={styles.fixNote}>rowMismatchBug is still true in config/bugs.json, so the pass comes from the code fix, not from turning the bug off.</p>
  </section>;
}
