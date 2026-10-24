export type TaskStatus = 'success' | 'failed' | 'running' | 'deferred' | 'skipped';
export type Bugs = { falseSuccessBug: boolean; rowMismatchBug: boolean; stuckDeferredBug: boolean; slowApiBug: boolean; silentErrorBug: boolean };
export type Task = { id: string; kind: string; status: TaskStatus; rows: number; durationSeconds: number };
export type PipelineRun = { dagId: string; runId: string; startedAt: string; status: 'success' | 'failed' | 'running'; durationSeconds: number; tasks: Task[] };
export type RunSeed = { dagId: string; runId: string; startedAt: string; sourceRowCount: number; tasks: {id: string; kind: string; durationSeconds: number}[] };

export function overallStatus(tasks: Task[], bugs: Bugs): PipelineRun['status'] {
  if (bugs.falseSuccessBug) {
    // Fault: terminal notification success masks upstream task failures.
    if (tasks.at(-1)?.status === 'success') return 'success';
  }
  if (tasks.some(task => task.status === 'failed')) return 'failed';
  if (bugs.stuckDeferredBug) {
    // Fault: deferred work is excluded from the completion gate.
    const completed = tasks.filter(task => task.status !== 'deferred');
    return completed.every(task => task.status === 'success') ? 'success' : 'running';
  }
  return tasks.every(task => task.status === 'success') ? 'success' : 'running';
}

export function simulateRun(seed: RunSeed, bugs: Bugs, startedAt?: string, now = Date.now()): PipelineRun {
  const elapsed = startedAt ? Math.max(0, (now - Date.parse(startedAt)) / 1000) : Infinity;
  const sourceRows = Array.from({ length: seed.sourceRowCount }, (_, id) => ({ id }));
  // Preserve the full batch, including when the row-mismatch reproduction switch is on.
  const loadBatch = sourceRows;
  const completedCount = Math.min(seed.tasks.length, Math.floor(elapsed));
  const tasks: Task[] = seed.tasks.map((task, index) => {
    let status: TaskStatus = index < completedCount ? 'success' : index === completedCount ? 'running' : 'skipped';
    let durationSeconds = status === 'success' ? task.durationSeconds : status === 'running' ? Math.round(elapsed * 10) / 10 : 0;
    let rows = status === 'success' && task.kind !== 'sensor' ? sourceRows.length : 0;
    if (task.id === 'load' && status === 'success') {
      rows = loadBatch.length;
      if (bugs.falseSuccessBug) {
        // Simulate a write exception; the faulty aggregation above hides it.
        try { throw new Error('Warehouse write rejected'); } catch { status = 'failed'; rows = 0; }
      }
    }
    if (task.kind === 'sensor' && bugs.stuckDeferredBug) {
      // Fault: reschedule without enforcing the sensor's deadline or blocking successors.
      const deferredAt = now - 7 * 60 * 60 * 1000;
      status = 'deferred'; durationSeconds = (now - deferredAt) / 1000; rows = 0;
    }
    return { ...task, status, rows, durationSeconds };
  });
  return {
    dagId: seed.dagId,
    runId: startedAt ? `manual__${startedAt}` : seed.runId,
    startedAt: startedAt ?? new Date(now - 10 * 60 * 1000).toISOString(),
    status: overallStatus(tasks, bugs),
    durationSeconds: Math.max(tasks.reduce((sum, task) => sum + task.durationSeconds, 0), 0),
    tasks,
  };
}
