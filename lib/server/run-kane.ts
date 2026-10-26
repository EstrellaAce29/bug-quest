import 'server-only';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { redact, testManagerUrl, type LiveResult } from '../quest-contract';
import { kaneArguments } from '../quest-engine';

export async function runKane(
  check: Pick<LiveResult, 'id' | 'title' | 'objective' | 'kind'>,
  signal: AbortSignal,
  log: (message: string) => void,
  url?: string,
  variablesFile?: string,
): Promise<LiveResult> {
  signal.throwIfAborted();
  const env: NodeJS.ProcessEnv = { ...process.env, KANE_CLI_USER_AGENT: 'codex' };
  // Kane never needs the OpenAI key. Do not pass it to subprocesses or their logs.
  delete env.OPENAI_API_KEY;
  for (const name of Object.keys(env)) if (/^(AIRFLOW_|PG|WAREHOUSE_)/.test(name)) delete env[name];
  const secrets = Object.entries(process.env).filter(([name]) => /KEY|PASSWORD|SECRET|TOKEN/.test(name)).map(([, value]) => value || '');
  return new Promise((resolve, reject) => {
    const child = spawn('kane-cli', [...kaneArguments(check.objective, url), ...(variablesFile ? ['--variables-file', variablesFile] : [])], {
      cwd: process.cwd(), env, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let terminal: Record<string, unknown> | null = null;
    let stderr = '';
    let stopped = false;
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      stopped = true;
      child.kill('SIGTERM');
      forceKill = setTimeout(() => child.kill('SIGKILL'), 3000);
    };
    signal.addEventListener('abort', stop, { once: true });
    const deadline = setTimeout(stop, 5 * 60 * 1000);
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      if (line.length > 2_000_000) return;
      try {
        const event = JSON.parse(line);
        if (event.type === 'run_end') terminal = event;
        else if (event.step && typeof event.remark === 'string') {
          log(redact(event.remark, secrets).slice(0, 700));
        } else if (event.type === 'ask_user') {
          log('Kane requested interactive input; this live run cannot answer prompts.');
          stop();
        }
      } catch { /* Non-JSON startup output is not a result. */ }
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
    function cleanup() {
      clearTimeout(deadline); clearTimeout(forceKill);
      signal.removeEventListener('abort', stop); lines.close();
    }
    child.once('error', () => {
      cleanup(); reject(new Error('Could not start Kane CLI. Check that kane-cli is installed and available on the server PATH.'));
    });
    child.once('close', code => {
      cleanup();
      if (signal.aborted) { reject(new Error('Quest cancelled.')); return; }
      if (!terminal) {
        // Don't forward raw stderr or local paths. Summarize common startup problems.
        const summary = stopped ? 'Kane stopped before returning a result (timeout or interactive prompt).'
          : /Chrome|CDP/i.test(stderr) ? 'Kane could not start or connect to Chrome.'
          : /auth|login|credential/i.test(stderr) ? 'Kane authentication needs attention. Sign in with Kane CLI in your terminal.'
          : `Kane exited without a completed result (exit ${code ?? 'unknown'}).`;
        resolve({ ...check, status: 'error', resultCode: null, summary, testUrl: null, credits: null, confirmedBug: false });
        return;
      }
      const result = terminal as Record<string, unknown>;
      const status = result.status === 'passed' && code === 0 ? 'passed' : result.status === 'failed' ? 'failed' : 'error';
      const numericCode = Number(result.result_code);
      const verdict = result.verdict as {confirmed?: boolean; family?: string} | undefined;
      const confirmedBug = status === 'failed' && (numericCode === 740 || (verdict?.confirmed === true && verdict.family === 'application_issue'));
      resolve({
        ...check, status,
        resultCode: result.result_code != null && Number.isFinite(numericCode) ? numericCode : null,
        summary: redact(typeof result.summary === 'string' ? result.summary : 'Kane returned no summary.', secrets).slice(0, 4000),
        testUrl: testManagerUrl(result.test_url),
        credits: typeof result.credits_consumed === 'number' && Number.isFinite(result.credits_consumed) ? result.credits_consumed : null,
        confirmedBug,
      });
    });
  });
}
