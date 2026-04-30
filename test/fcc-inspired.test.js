import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import { initConfig, writeProfile, readProfile } from '../src/config.js';
import { listenProxy } from '../src/proxy.js';
import { listProviders, resolveProvider } from '../src/providers.js';

function upstreamWithStatuses(statuses) {
  const seen = [];
  let calls = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      seen.push(JSON.parse(body || '{}'));
      const status = statuses[Math.min(calls, statuses.length - 1)];
      calls += 1;
      if (status !== 200) {
        res.writeHead(status, { 'Content-Type': 'application/json', 'Retry-After': '0' });
        res.end(JSON.stringify({ error: { message: 'try later sk-test-secret' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'ok', choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}` })));
}

test('provider catalog exposes safe built-in presets without secrets', () => {
  const providers = listProviders();
  assert.ok(providers.some((p) => p.id === 'letsur'));
  assert.ok(providers.some((p) => p.id === 'openai-compatible'));
  assert.equal(providers.every((p) => !JSON.stringify(p).includes('sk-')), true);
  const letsur = resolveProvider('letsur');
  assert.equal(letsur.defaultBaseUrl, 'https://gw.letsur.ai/v1');
  assert.equal(letsur.transport, 'openai-chat-completions');
});

test('profile create can derive provider defaults from provider id', async () => {
  const dir = await fs.mkdtemp('/tmp/cpk-provider-config-');
  const env = { CPK_CONFIG_DIR: dir };
  await initConfig(env);
  await writeProfile({ name: 'p', provider: 'letsur', visible_model: 'claude-opus-4-7', upstream: { model: 'gpt-5.5', api_key_env: 'LETSUR_API_KEY' } }, env);
  const profile = await readProfile('p', env);
  assert.equal(profile.provider, 'letsur');
  assert.equal(profile.upstream.base_url, 'https://gw.letsur.ai/v1');
  assert.equal(profile.upstream.type, 'openai-chat-completions');
  assert.equal(profile.capabilities.thinking, true);
  assert.equal(profile.capabilities.streaming, true);
});

test('proxy supports Claude Code compatibility probes and model listing', async () => {
  const upstream = await upstreamWithStatuses([200]);
  const env = { TEST_KEY: 'abc', CPK_STATE_DIR: await fs.mkdtemp('/tmp/cpk-state-') };
  const profile = { name: 'test', visible_model: 'claude-opus-4-7', max_output_tokens: 64, upstream: { base_url: upstream.url, model: 'gpt-5.5', api_key_env: 'TEST_KEY' }, capabilities: {} };
  const proxy = await listenProxy(profile, { env, token: 'local' });
  try {
    const optionsNoAuth = await fetch(`${proxy.url}/v1/messages`, { method: 'OPTIONS' });
    assert.equal(optionsNoAuth.status, 401);
    const headNoAuth = await fetch(`${proxy.url}/v1/messages`, { method: 'HEAD' });
    assert.equal(headNoAuth.status, 401);
    const options = await fetch(`${proxy.url}/v1/messages`, { method: 'OPTIONS', headers: { 'x-api-key': 'local' } });
    assert.equal(options.status, 204);
    assert.match(options.headers.get('allow'), /POST/);
    const head = await fetch(`${proxy.url}/v1/messages`, { method: 'HEAD', headers: { 'x-api-key': 'local' } });
    assert.equal(head.status, 204);
    const modelsNoAuth = await fetch(`${proxy.url}/v1/models`);
    assert.equal(modelsNoAuth.status, 401);
    const models = await fetch(`${proxy.url}/v1/models`, { headers: { 'x-api-key': 'local' } });
    assert.equal(models.status, 200);
    const data = await models.json();
    assert.deepEqual(data.data.map((m) => m.id), ['opus', 'claude-opus-4-7']);
  } finally {
    proxy.server.close();
    upstream.server.close();
  }
});

test('proxy retries 429 before response is sent and redacts upstream errors', async () => {
  const upstream = await upstreamWithStatuses([429, 200]);
  const env = { TEST_KEY: 'abc', CPK_STATE_DIR: await fs.mkdtemp('/tmp/cpk-state-') };
  const profile = { name: 'retry', visible_model: 'claude-opus-4-7', max_output_tokens: 64, upstream: { base_url: upstream.url, model: 'gpt-5.5', api_key_env: 'TEST_KEY' }, capabilities: {}, retry: { max_retries: 1, base_delay_ms: 0 } };
  const proxy = await listenProxy(profile, { env, token: 'local' });
  try {
    const resp = await fetch(`${proxy.url}/v1/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': 'local' }, body: JSON.stringify({ model: 'claude-opus-4-7', messages: [{ role: 'user', content: 'hi' }] }) });
    assert.equal(resp.status, 200);
    assert.equal(upstream.seen.length, 2);
  } finally {
    proxy.server.close();
    upstream.server.close();
  }

  const failing = await upstreamWithStatuses([429, 429]);
  const failingProfile = { ...profile, upstream: { ...profile.upstream, base_url: failing.url } };
  const failingProxy = await listenProxy(failingProfile, { env, token: 'local' });
  try {
    const resp = await fetch(`${failingProxy.url}/v1/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': 'local' }, body: JSON.stringify({ model: 'claude-opus-4-7', messages: [{ role: 'user', content: 'hi' }] }) });
    const text = await resp.text();
    assert.equal(resp.status, 429);
    assert.equal(text.includes('sk-test-secret'), false);
  } finally {
    failingProxy.server.close();
    failing.server.close();
  }
});
