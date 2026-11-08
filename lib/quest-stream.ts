import type { LiveEvent } from './quest-contract';
import { QUEST_TIMEOUTS, withQuestTimeout } from './quest-timeout';

export async function consumeQuestStream(body: ReadableStream<Uint8Array>, signal: AbortSignal, receive: (event: LiveEvent) => void, idleMs = QUEST_TIMEOUTS.streamIdle) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    while (true) {
      const { value, done } = await withQuestTimeout('Quest progress stream (no updates received)', idleMs, signal, () => reader.read());
      pending += decoder.decode(value, { stream: !done });
      let boundary: number;
      while ((boundary = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, boundary); pending = pending.slice(boundary + 1);
        if (line.trim()) {
          const event = JSON.parse(line) as LiveEvent;
          receive(event);
          if (event.type === 'done' || event.type === 'error') return;
        }
      }
      if (done) break;
    }
    if (pending.trim()) receive(JSON.parse(pending) as LiveEvent);
  } finally {
    // Do not let a stuck source's cancel promise keep the UI spinning.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
