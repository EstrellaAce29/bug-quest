import { expandQuest } from '@/lib/server/expand-quest';
import { runKane } from '@/lib/server/run-kane';
import { redact, type LiveEvent } from '@/lib/quest-contract';
import { executeQuest } from '@/lib/quest-engine';
import { attemptAutoFix } from '@/lib/auto-fix';
import { createFixWorkspace } from '@/lib/server/fix-workspace';
import { proposePipelineFix } from '@/lib/server/propose-fix';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 7200;

// One browser quest at a time, including during Next.js development reloads.
const state = globalThis as typeof globalThis & { bugQuestLiveBusy?: boolean };

export async function POST(request: Request) {
  const host = request.headers.get('host') ?? '';
  if (!['localhost:3000', '127.0.0.1:3000'].includes(host)) return Response.json({ error: 'Live quests are available only on localhost:3000.' }, { status: 403 });
  const origin = request.headers.get('origin');
  if (origin && !['http://localhost:3000', 'http://127.0.0.1:3000'].includes(origin)) return Response.json({ error: 'Use the local quest page.' }, { status: 403 });
  if (!request.headers.get('content-type')?.includes('application/json')) return Response.json({ error: 'Send a JSON request.' }, { status: 415 });
  const text = await request.text();
  if (text.length > 8000) return Response.json({ error: 'Quest input is too long.' }, { status: 400 });
  let input: { agent?: unknown; instruction?: unknown };
  try { input = JSON.parse(text); } catch { return Response.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  if (!input || typeof input.agent !== 'string' || !input.agent.trim() || input.agent.length > 80 ||
      typeof input.instruction !== 'string' || !input.instruction.trim() || input.instruction.length > 1000) {
    return Response.json({ error: 'Provide an agent name (up to 80 characters) and instruction (up to 1,000 characters).' }, { status: 400 });
  }
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return Response.json({ error: 'Set OPENAI_API_KEY in .env.local before starting a live quest.' }, { status: 503 });
  if (state.bugQuestLiveBusy) return Response.json({ error: 'Another live quest is running. Wait for it to finish.' }, { status: 409 });
  state.bugQuestLiveBusy = true;
  const agent = redact(input.agent.trim(), [apiKey]);
  const instruction = input.instruction;
  const abort = new AbortController();
  const disconnected = () => abort.abort();
  request.signal.addEventListener('abort', disconnected, { once: true });
  if (request.signal.aborted) abort.abort();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (event: LiveEvent) => {
        if (closed || abort.signal.aborted) return;
        try { controller.enqueue(encoder.encode(redact(JSON.stringify(event), [apiKey]) + '\n')); }
        catch { closed = true; abort.abort(); }
      };
      const log = (message: string) => emit({ type: 'log', message: `${agent}: ${message}` });
      const heartbeat = setInterval(() => log('still working...'), 15000);
      try {
        await executeQuest({ agent, instruction }, {
          expand: expandQuest, run: runKane,
          repair: (failure, basic, signal, log, update) => attemptAutoFix(failure, basic, {
            ...createFixWorkspace(), propose: proposePipelineFix, run: runKane,
          }, signal, log, update),
        }, abort.signal, emit);
      } catch (error) {
        if (!abort.signal.aborted) emit({ type: 'error', message: error instanceof Error ? redact(error.message, [apiKey]) : 'Live quest failed. Try again.' });
      } finally {
        clearInterval(heartbeat);
        state.bugQuestLiveBusy = false;
        request.signal.removeEventListener('abort', disconnected);
        if (!closed) { closed = true; try { controller.close(); } catch { /* Client disconnected. */ } }
      }
    },
    cancel() { abort.abort(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' } });
}
