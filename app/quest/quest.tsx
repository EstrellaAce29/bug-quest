'use client';

import { useState } from 'react';
import RecordedQuest from './recorded-quest';
import LiveQuest from './live-quest';
import styles from './quest.module.css';

export default function Quest() {
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  return <>
    <div className={styles.modeBar}>
      <span>{live ? 'Real OpenAI expansion + Kane browser runs' : 'Recorded replay'}</span>
      <label className={styles.modeToggle}><input type="checkbox" role="switch" checked={live} onChange={event => setLive(event.target.checked)} disabled={busy} /><span aria-hidden="true" />Live mode</label>
    </div>
    {live ? <LiveQuest onBusyChange={setBusy} /> : <RecordedQuest />}
  </>;
}
