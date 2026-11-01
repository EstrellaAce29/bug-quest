import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelSettings, structuredModel } from '../lib/model-provider';
const signal = new AbortController().signal;
const env = { NODE_ENV: 'test', OPENAI_API_KEY: 'private-test-key', OPENAI_MODEL: 'test-model' } as NodeJS.ProcessEnv;

test('OpenAI adapter uses structured Responses output and keeps provider errors free of secrets', async () => {
  let sent: Record<string, unknown> = {};
  const result = await structuredModel('rules', { strategy: 'rows' }, { type: 'object' }, signal, { env, fetch: async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer private-test-key');
    sent = JSON.parse(String(init?.body));
    return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: '{"checks":[]}' }] }] });
  } });
  assert.deepEqual(result, { checks: [] }); assert.equal(sent.store, false); assert.equal(sent.model, 'test-model');
  await assert.rejects(structuredModel('rules', {}, {}, signal, { env, fetch: async () => new Response('private-test-key', { status: 401 }) }), error => error instanceof Error && !error.message.includes('private-test-key'));
});

test('Ollama adapter sends schema and messages locally without OpenAI credentials', async () => {
  const result = await structuredModel('rules', { strategy: 'wins' }, { type: 'object' }, signal, { env: { ...env, ARENA_MODEL_PROVIDER: 'ollama', OLLAMA_MODEL: 'llama-test' }, fetch: async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:11434/api/chat');
    assert.equal((init?.headers as Record<string, string>).Authorization, undefined);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'llama-test'); assert.equal(body.stream, false); assert.deepEqual(body.format, { type: 'object' });
    assert.equal(body.messages[0].role, 'system');
    return Response.json({ done: true, message: { content: '{"ok":true}' } });
  } });
  assert.deepEqual(result, { ok: true });
  assert.throws(() => modelSettings({ ...env, ARENA_MODEL_PROVIDER: 'unknown' }));
  assert.throws(() => modelSettings({ ...env, ARENA_MODEL_PROVIDER: 'ollama', OLLAMA_BASE_URL: 'https://remote.example' }));
});

test('adapters reject truncated and malformed output rather than running unvalidated checks', async () => {
  await assert.rejects(structuredModel('rules', {}, {}, signal, { env, fetch: async () => Response.json({ status: 'incomplete' }) }), /incomplete/);
  await assert.rejects(structuredModel('rules', {}, {}, signal, { env, fetch: async () => Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: 'not json' }] }] }) }), /valid JSON/);
});
