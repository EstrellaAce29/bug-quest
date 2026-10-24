'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Bugs, PipelineRun, TaskStatus } from '@/lib/pipeline';

function duration(seconds: number) {
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${seconds.toFixed(seconds % 1 ? 1 : 0)}s`;
}
function Status({ status }: {status: TaskStatus}) {
  return <span className={`status status-${status}`}><i aria-hidden="true" />{status}</span>;
}
export default function PipelineMonitor({ bugs }: {bugs: Bugs}) {
  const [run, setRun] = useState<PipelineRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const generation = useRef(0);

  const fetchRun = useCallback(async (method = 'GET', startedAt?: string) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestId = ++generation.current;
    setError(null);
    if (method === 'POST') setTriggering(true);
    else setLoading(true);
    // Fault: slow mode omits the request deadline, leaving the spinner indefinitely
    // on a hanging upstream. Normally every request has a five-second deadline.
    const timeout = bugs.slowApiBug ? undefined : window.setTimeout(() => controller.abort('timeout'), 5000);
    try {
      const query = startedAt ? `?startedAt=${encodeURIComponent(startedAt)}` : '';
      const response = await fetch(`/api/pipeline-runs${query}`, { method, cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`Pipeline API returned ${response.status}`);
      const data: PipelineRun = await response.json();
      if (requestId !== generation.current) return;
      setRun(data);
      setUpdatedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (cause) {
      if (requestId !== generation.current || (controller.signal.aborted && controller.signal.reason !== 'timeout')) return;
      setRun(null);
      if (!bugs.silentErrorBug) {
        setError(controller.signal.reason === 'timeout'
          ? 'Request timed out after 5 seconds. The pipeline API is taking too long. Please retry.'
          : cause instanceof Error ? `Unable to load pipeline data. ${cause.message}. Please retry.` : 'Unable to load pipeline data. Please retry.');
      }
      // Fault: silent mode discards the exception, leaving an unexplained empty list.
    } finally {
      window.clearTimeout(timeout);
      if (requestId === generation.current) { setLoading(false); setTriggering(false); }
    }
  }, [bugs.slowApiBug, bugs.silentErrorBug]);

  useEffect(() => { void fetchRun(); return () => { generation.current++; controllerRef.current?.abort(); }; }, [fetchRun]);
  const isSimulating = !!run && run.runId.startsWith('manual__') && run.tasks.some(task => task.status === 'running' || task.status === 'skipped');
  useEffect(() => {
    if (!isSimulating || !run || error) return;
    const timer = window.setTimeout(() => void fetchRun('GET', run.startedAt), 1000);
    return () => window.clearTimeout(timer);
  }, [run, isSimulating, error, fetchRun]);

  const tasks = run?.tasks ?? [];
  const completed = tasks.filter(task => task.status === 'success').length;
  const busy = triggering || isSimulating || loading;
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/pipelines"><span className="brand-mark">⌘</span>Bug Quest<span className="brand-dot" /></a>
      <div className="workspace"><span className="workspace-icon">BQ</span><span>Local workspace<small>Development</small></span><span className="chevrons">⌃<br />⌄</span></div>
      <p className="nav-label">WORKSPACE</p>
      <nav aria-label="Main navigation"><a className="nav-active" href="/pipelines"><span>▦</span> Pipelines <b>1</b></a></nav>
      <div className="sidebar-bottom"><span className="connection-dot" /> Local environment<small>localhost:3000</small><div className="profile"><span>PC</span><div>Pipeline operator<small>Local workspace</small></div></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div><span className="muted">Workspace</span><span className="breadcrumb-slash">/</span>Pipelines</div><span className="environment"><i />Development</span></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow">OBSERVABILITY</div><h1>Pipeline Monitor</h1><p>Every task. Every row. A clear view of your pipeline.</p></div><span className="dag-count">1 DAG</span></div>
        {error && <div className="error-banner" role="alert"><span aria-hidden="true">!</span><div><strong>Pipeline data unavailable</strong><p>{error}</p></div><button onClick={() => void fetchRun()}>Retry</button></div>}
        <section className="dag-card" aria-label="DAG overview">
          <div className="dag-title-row"><div className="dag-title"><span className="dag-icon" aria-hidden="true">⑂</span><div><div className="dag-label">DAG OVERVIEW</div><h2>enrollment_pipeline</h2></div>{run && <Status status={run.status} />}</div><button className="trigger-button" disabled={busy} onClick={() => { setActiveTask(null); void fetchRun('POST'); }}><span aria-hidden="true">{busy ? '◌' : '▷'}</span>{triggering || isSimulating ? 'Run in progress' : 'Trigger run'}</button></div>
          <p className="dag-description">Student enrollment · source to warehouse</p>
          <div className="metrics"><div><span>LAST RUN</span><strong>{run ? new Date(run.startedAt).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' }) : '—'}</strong><small>{run?.runId.startsWith('manual__') ? 'Manually triggered' : 'Scheduled run'}</small></div><div><span>OVERALL STATUS</span><strong>{run ? <><i className={`metric-dot ${run.status}`} />{run.status[0].toUpperCase() + run.status.slice(1)}</> : '—'}</strong><small>{run?.status === 'success' ? 'Run marked complete' : run?.status === 'failed' ? 'A task needs attention' : run ? 'Tasks are processing' : 'Waiting for data'}</small></div><div><span>TOTAL DURATION</span><strong className="mono">{run ? duration(run.durationSeconds) : '—'}</strong><small>Across all tasks</small></div><div><span>TASKS COMPLETED</span><strong>{run ? <>{completed}<em> / {tasks.length}</em></> : '—'}</strong><small>Successful tasks</small></div></div>
        </section>
        <section className="flow-section" aria-label="Pipeline task graph"><div className="section-title"><h3>Pipeline flow</h3><span>Sequential execution</span></div><div className="flow-track">{tasks.length ? tasks.map((task, index) => <div className="flow-step" key={task.id}><button onClick={() => setActiveTask(activeTask === task.id ? null : task.id)} className={`flow-node node-${task.status} ${activeTask === task.id ? 'selected' : ''}`} aria-pressed={activeTask === task.id}><span className="node-symbol">{task.status === 'success' ? '✓' : task.status === 'failed' ? '!' : task.status === 'deferred' ? '◷' : '·'}</span><span>{task.id}</span></button>{index < tasks.length - 1 && <span className="flow-connector" aria-hidden="true">→</span>}</div>) : <span className="flow-placeholder">{loading ? 'Loading pipeline flow…' : 'No task data available'}</span>}</div></section>
        <section className="tasks-card" aria-label="Task list"><div className="tasks-heading"><div><h3>Task details <span>{tasks.length}</span></h3><p>Execution status and output for each step.</p></div><div className="live-label"><i />{loading ? 'Updating' : 'Latest run'}</div></div>
          <div className="table-scroll"><table><thead><tr><th scope="col">TASK NAME</th><th scope="col">STATUS</th><th scope="col">ROWS PROCESSED</th><th scope="col">DURATION</th></tr></thead><tbody>{tasks.map((task, index) => <tr key={task.id} className={activeTask === task.id ? 'selected-row' : ''}><td><span className="task-number">{String(index + 1).padStart(2, '0')}</span><span className="task-name">{task.id}</span>{task.kind === 'sensor' && <span className="sensor-tag">sensor</span>}</td><td><Status status={task.status} /></td><td className="mono">{task.rows.toLocaleString('en-US')}</td><td className="mono muted">{duration(task.durationSeconds)}</td></tr>)}</tbody></table></div>
          {loading && !run && <div className="empty-state" role="status"><span className="spinner" />Loading pipeline data…</div>}
          {!loading && !tasks.length && <div className="empty-state">No task data available</div>}
          <div className="table-footer"><span>{tasks.length} tasks · enrollment_pipeline</span><span>{updatedAt ? `Updated ${updatedAt}` : 'Not yet updated'}</span></div>
        </section>
        <footer className="page-footer"><span><i />All times shown in your local timezone</span><span>Bug Quest <b> / </b> Pipeline observability</span></footer>
      </main>
    </div>
  </div>;
}
