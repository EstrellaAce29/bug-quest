export const QUEST_TIMEOUTS = {
  openAI: 60_000, proposal: 90_000, kane: 180_000,
  warehouse: 20_000, airflowRequest: 15_000, dagParse: 120_000, dagRun: 300_000,
  connect: 15_000, streamIdle: 30_000,
};

export class QuestTimeoutError extends Error {
  constructor(public step: string, public milliseconds: number) {
    super(`${step} timed out after ${milliseconds / 1000} seconds. Check the service and retry.`);
    this.name = 'QuestTimeoutError';
  }
}

// Race the deadline as well as aborting: a stalled SDK/child process may ignore abort.
export async function withQuestTimeout<T>(step: string, milliseconds: number, parent: AbortSignal, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  parent.throwIfAborted();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: () => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    onAbort = () => { reject(parent.reason); controller.abort(parent.reason); };
    parent.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      const error = new QuestTimeoutError(step, milliseconds);
      reject(error); controller.abort(error);
    }, milliseconds);
  });
  try { return await Promise.race([interrupted, Promise.resolve().then(() => { controller.signal.throwIfAborted(); return work(controller.signal); })]); }
  finally { clearTimeout(timer); parent.removeEventListener('abort', onAbort); }
}
