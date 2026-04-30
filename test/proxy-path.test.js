import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { listenProxy } from '../src/proxy.js';

function fakeUpstream() {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      seen.push(JSON.parse(body || '{}'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'x', choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}` })));
}

test('proxy routes messages and models by URL pathname, ignoring query string', async () => {
  const upstream = await fakeUpstream();
  const env = { TEST_KEY: 'abc' };
  const profile = { name: 'test', visible_model: 'claude-opus-4-7', client_model: 'opus', max_output_tokens: 64, upstream: { base_url: upstream.url, model: 'gpt-5.5', api_key_env: 'TEST_KEY' }, capabilities: {} };
  const proxy = await listenProxy(profile, { env, token: 'local' });
  try {
    const models = await fetch(`${proxy.url}/v1/models?anthropic-version=2023-06-01`, { headers: { 'x-api-key': 'local' } });
    assert.equal(models.status, 200);
    const resp = await fetch(`${proxy.url}/v1/messages?anthropic-version=2023-06-01`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': 'local' }, body: JSON.stringify({ model: 'opus', messages: [{ role: 'user', content: 'hi' }] }) });
    assert.equal(resp.status, 200);
    assert.equal(upstream.seen[0].model, 'gpt-5.5');
  } finally {
    proxy.server.close();
    upstream.server.close();
  }
});
