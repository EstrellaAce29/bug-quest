import { NextRequest, NextResponse } from 'next/server';
import { readBugs, readSeed } from '@/lib/config';
import { simulateRun } from '@/lib/pipeline';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
async function respond(startedAt?: string) {
  try {
    const [bugs, seed] = await Promise.all([readBugs(), readSeed()]);
    if (bugs.slowApiBug) {
      // Fault: a synchronous request waits on an unbounded simulated upstream retry.
      await new Promise(resolve => setTimeout(resolve, 8000));
    }
    if (bugs.silentErrorBug) {
      // Simulate a genuine backend exception; the corresponding UI catch drops it.
      throw new Error('Pipeline data source is unavailable');
    }
    return NextResponse.json(simulateRun(seed, bugs, startedAt), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Could not load pipeline data. Please retry.' }, { status: 500 });
  }
}
export async function GET(request: NextRequest) {
  const startedAt = request.nextUrl.searchParams.get('startedAt') ?? undefined;
  if (startedAt && (!Number.isFinite(Date.parse(startedAt)) || Date.parse(startedAt) > Date.now() + 1000)) {
    return NextResponse.json({ error: 'Invalid run start time' }, { status: 400 });
  }
  return respond(startedAt);
}
export async function POST() { return respond(new Date().toISOString()); }
