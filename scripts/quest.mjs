#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';

const usage = 'npm run quest [-- --name <AgentName> --instruction "..."]';
const clean = value => String(value).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');

export function questOptions(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') return { help: true };
    if (!['--name', '--instruction'].includes(args[i]) || args[i + 1] === undefined || args[i + 1].startsWith('--')) throw new Error(usage);
    options[args[i].slice(2)] = args[++i];
  }
  if (options.name !== undefined && (!options.name.trim() || options.name.length > 80)) throw new Error('Name your agent using 1–80 characters.');
  if (options.instruction !== undefined && (!options.instruction.trim() || options.instruction.length > 1000)) throw new Error('Enter a nonblank check of up to 1,000 characters.');
  return { agent: options.name?.trim(), instruction: options.instruction?.trim(), target: 'airflow' };
}

/**
 * @param {string[]} [args]
 * @param {{fetcher?: typeof fetch, print?: (text: string) => void, signal?: AbortSignal, ask?: (text: string) => Promise<string>}} [dependencies]
 */
export async function runQuest(args = process.argv.slice(2), { fetcher = fetch, print = console.log, signal, ask } = {}) {
  const options = questOptions(args);
  const write = text => print(clean(text));
  if (options.help) { write(usage + '\nPrompts for a name, a free-text check, then Enter to run. Flags only prefill answers. Requires an interactive terminal. Start npm run dev first. Ctrl+C cancels.'); return; }
  if (!ask && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new Error('Run npm run quest in an interactive terminal. No quest was started.');
  const terminal = ask ? null : createInterface({ input: process.stdin, output: process.stdout });
  const question = ask ?? (text => terminal.question(text, { signal }));
  async function required(label, prefill, limit) {
    while (true) {
      signal?.throwIfAborted();
      const answer = String(await question(`${label}${prefill ? ` [${clean(prefill)}]` : ''}: `)).trim() || prefill || '';
      signal?.throwIfAborted();
      if (answer && answer.length <= limit) return answer;
      write(`Enter 1–${limit} characters. Nothing has started.`);
    }
  }
  let agent, instruction;
  try {
    agent = await required('Name your agent', options.agent, 80);
    instruction = await required('What should your agent check?', options.instruction, 1000);
    const confirmation = await question('Press Enter to run the quest, or type cancel to exit: ');
    signal?.throwIfAborted();
    if (String(confirmation).trim() !== '') { write('Cancelled. No quest was started.'); return; }
  } finally { terminal?.close(); }
  const launch = { agent, instruction, target: options.target, confirmed: true };
  write(`Running ${agent}. Stage: http://127.0.0.1:3000/stage (open it yourself). Browser checks stay headless.`);
  let response;
  try {
    response = await fetcher('http://127.0.0.1:3000/api/quest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(launch), signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('Could not reach Bug Quest. Start npm run dev at http://127.0.0.1:3000.');
  }
  if (!response.ok) {
    const body = await response.json();
    throw new Error(body.error || `Quest request failed (HTTP ${response.status}).`);
  }
  if (!response.body) throw new Error('The server did not return a live stream.');
  let finished = false;
  function receive(event) {
    if (event.type === 'log') write(event.message);
    if (event.type === 'plan') write(`Precise checks:\n${event.objectives.map(o => `  • ${o.title}: ${o.objective}`).join('\n')}`);
    if (event.type === 'result') write(`${event.result.title}: ${event.result.status.toUpperCase()} · ${event.result.summary}${event.result.testUrl ? `\nEvidence: ${event.result.testUrl}` : ''}`);
    if (event.type === 'fix') write(`Repair: ${event.report.status} · ${event.report.message}`);
    if (event.type === 'error') throw new Error(event.message);
    if (event.type === 'done') {
      finished = true;
      write(`${event.escalated ? 'Escalated to human' : 'Quest complete'}: ${event.points} points · ${event.bugsFound} bugs · ${event.fixesVerified ?? 0} verified fixes · ${event.falseAlarms ?? 0} false alarms`);
    }
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      let boundary;
      while ((boundary = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, boundary); pending = pending.slice(boundary + 1);
        if (line.trim()) receive(JSON.parse(line));
      }
      if (done) break;
    }
    if (pending.trim()) receive(JSON.parse(pending));
    if (!finished) throw new Error('The connection ended before the quest completed.');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  runQuest(undefined, { signal: abort.signal }).catch(error => {
    console.error(clean(abort.signal.aborted ? 'Quest cancelled. Partial scores remain on /stage.' : error.message));
    process.exitCode = abort.signal.aborted ? 130 : 1;
  }).finally(() => { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); });
}
