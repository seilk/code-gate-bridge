import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { listenProxy } from '../src/proxy.js';

function fakeUpstream() {
  const server = http.createServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'x', choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

test('/v1/models advertises Claude Code selector and visible model', async () => {
  const upstream = await fakeUpstream();
  const env = { TEST_KEY: 'abc' };
  const profile = { name: 'test', visible_model: 'claude-opus-4-7', client_model: 'opus', upstream: { base_url: upstream.url, model: 'gpt-5.5', api_key_env: 'TEST_KEY' }, capabilities: {} };
  const proxy = await listenProxy(profile, { env, token: 'local' });
  try {
    const resp = await fetch(`${proxy.url}/v1/models`, { headers: { 'x-api-key': 'local' } });
    const data = await resp.json();
    assert.equal(resp.status, 200);
    assert.deepEqual(data.data.map((model) => model.id), ['opus', 'claude-opus-4-7']);
  } finally {
    proxy.server.close();
    upstream.server.close();
  }
});
