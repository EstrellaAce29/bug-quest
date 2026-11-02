import { stageStore } from '@/lib/server/stage-store';
import { resetStage, stageView } from '@/lib/stage';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const host = request.headers.get('host') ?? '';
  const origin = request.headers.get('origin');
  if (!['localhost:3000', '127.0.0.1:3000'].includes(host) || (origin && !['http://localhost:3000', 'http://127.0.0.1:3000'].includes(origin))) return Response.json({ error: 'Use the local stage.' }, { status: 403 });
  if (!request.headers.get('content-type')?.includes('application/json')) return Response.json({ error: 'Send JSON.' }, { status: 415 });
  const text = await request.text();
  if (text.length > 2000) return Response.json({ error: 'Stage input is too long.' }, { status: 400 });
  let input;
  try { input = JSON.parse(text); } catch { return Response.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  if (!input || !['state', 'reset'].includes(input.action)) return Response.json({ error: 'Choose state or reset.' }, { status: 400 });
  const stage = stageStore();
  if (input.action === 'reset') resetStage(stage);
  const after = Number.isSafeInteger(input.after) && input.after >= 0 ? input.after : 0;
  return Response.json(stageView(stage, after), { headers: { 'Cache-Control': 'no-store' } });
}
