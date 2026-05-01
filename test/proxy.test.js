import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { listenProxy } from '../src/proxy.js';

function fakeUpstream() {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = ''; req.setEncoding('utf8'); req.on('data', c => body += c); req.on('end', () => {
      seen.push(JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'x', choices: [{ message: { content: 'UP_OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 4 } }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}` })));
}

test('proxy authenticates and sends upstream model', async () => {
  const upstream = await fakeUpstream();
  const env = { TEST_KEY: 'abc', CGB_STATE_DIR: await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/cgb-state-')) };
  const profile = { name: 'test', visible_model: 'claude-opus-4-7', max_output_tokens: 64, upstream: { base_url: upstream.url, model: 'gpt-4.1', api_key_env: 'TEST_KEY' }, capabilities: {} };
  const proxy = await listenProxy(profile, { env, token: 'local' });
  try {
    const resp = await fetch(`${proxy.url}/v1/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': 'local' }, body: JSON.stringify({ model: 'claude-opus-4-7', messages: [{ role: 'user', content: 'hi' }] }) });
    const data = await resp.json();
    assert.equal(resp.status, 200);
    assert.equal(data.content[0].text, 'UP_OK');
    assert.equal(upstream.seen[0].model, 'gpt-4.1');
  } finally { proxy.server.close(); upstream.server.close(); }
});
