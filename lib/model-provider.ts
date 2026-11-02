// Server callers only. Credentials are never included in errors or returned data.
export function modelSettings(env: NodeJS.ProcessEnv = process.env) {
  const provider = env.PLAY_MODEL_PROVIDER || 'openai';
  if (!['openai', 'ollama'].includes(provider)) throw new Error('PLAY_MODEL_PROVIDER must be openai or ollama.');
  if (provider === 'openai') {
    if (!env.OPENAI_API_KEY?.trim()) throw new Error('Set OPENAI_API_KEY in .env.local.');
    return { provider, model: env.PLAY_MODEL || env.OPENAI_MODEL || 'gpt-6-luna', url: 'https://api.openai.com/v1/responses' };
  }
  const url = new URL(env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('OLLAMA_BASE_URL must be a local HTTP origin.');
  return { provider, model: env.PLAY_MODEL || env.OLLAMA_MODEL || 'llama3.1', url: `${url.origin}/api/chat` };
}

export async function structuredModel(instructions: string, input: unknown, schema: Record<string, unknown>, signal: AbortSignal, options: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch } = {}): Promise<unknown> {
  const env = options.env ?? process.env;
  const settings = modelSettings(env);
  const openai = settings.provider === 'openai';
  const response = await (options.fetch ?? fetch)(settings.url, {
    method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]),
    headers: { 'Content-Type': 'application/json', ...(openai ? { Authorization: `Bearer ${env.OPENAI_API_KEY!.trim()}` } : {}) },
    body: JSON.stringify(openai ? {
      model: settings.model, store: false, instructions, input: JSON.stringify(input), max_output_tokens: 2500,
      text: { format: { type: 'json_schema', name: 'play_objectives', strict: true, schema } },
    } : {
      model: settings.model, stream: false, format: schema,
      messages: [{ role: 'system', content: instructions }, { role: 'user', content: JSON.stringify(input) }],
    }),
  });
  if (!response.ok) throw new Error(`${settings.provider} model request failed (HTTP ${response.status}).`);
  const body = await response.json();
  if (openai ? body.status !== 'completed' : body.done !== true) throw new Error('Model output was incomplete.');
  const text = openai ? (body.output ?? []).flatMap((item: { content?: { type: string; text?: string }[] }) => item.content ?? []).filter((item: { type: string }) => item.type === 'output_text').map((item: { text?: string }) => item.text ?? '').join('') : body.message?.content;
  try { return JSON.parse(text); } catch { throw new Error('Model output was not valid JSON.'); }
}
