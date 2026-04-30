import http from 'node:http';
import crypto from 'node:crypto';
import { anthropicToOpenAI, openAIToAnthropic, openAIStreamToAnthropic } from './adapter.js';
import { resolveApiKey } from './config.js';
import { logEvent, writeState } from './state.js';
import { redact } from './redact.js';

const MAX_BODY_BYTES = 10_000_000;
const DEFAULT_TIMEOUT_MS = 120_000;

export async function createProxy(profile, options = {}) {
  const host = options.host || '127.0.0.1';
  if (host !== '127.0.0.1' && options.allowUnsafeHost !== true) throw new Error('proxy host must be 127.0.0.1 unless allowUnsafeHost is true');
  const port = Number(options.port || 0);
  const token = options.token || randomToken();
  const env = options.env || process.env;
  const apiKey = await resolveApiKey(profile, env);
  const timeoutMs = Number(options.timeoutMs || env.CPK_UPSTREAM_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const server = http.createServer(async (req, res) => {
    let requestId = crypto.randomUUID();
    try {
      if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true });
      if (req.method !== 'POST' || req.url !== '/v1/messages') return json(res, 404, { error: { type: 'not_found', message: 'not found' } });
      if (!validAuth(req, token)) return json(res, 401, { error: { type: 'authentication_error', message: 'missing or invalid local proxy token' } });
      const raw = await readBody(req);
      const anthropic = JSON.parse(raw || '{}');
      const upstreamBody = anthropicToOpenAI(anthropic, profile);
      requestId = `cpk_${crypto.randomUUID()}`;
      await writeState({ attempted_request_id: requestId, active_profile: profile.name, visible_model: profile.visible_model, attempted_upstream_model: profile.upstream.model, proxy_url: `http://${host}:${server.address().port}` }, env);
      await logEvent('request.forward', { request_id: requestId, profile: profile.name, visible_model: profile.visible_model, upstream_model: profile.upstream.model, upstream_base_url: profile.upstream.base_url }, env);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let upstream;
      try {
        upstream = await fetch(`${profile.upstream.base_url}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(upstreamBody), signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      await logEvent('response.received', { request_id: requestId, status: upstream.status, upstream_model: profile.upstream.model }, env);
      if (!upstream.ok) return pipeError(res, upstream);
      await writeState({ last_successful_request_id: requestId, active_profile: profile.name, visible_model: profile.visible_model, upstream_model: profile.upstream.model, upstream_base_url: profile.upstream.base_url, proxy_url: `http://${host}:${server.address().port}`, last_success_at: new Date().toISOString() }, env);
      if (upstreamBody.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        for await (const event of openAIStreamToAnthropic(upstream.body, profile)) res.write(event);
        res.end();
      } else {
        json(res, 200, openAIToAnthropic(await upstream.json(), profile));
      }
    } catch (error) {
      const message = error?.name === 'AbortError' ? 'upstream request timed out' : error.message;
      await logEvent('request.failed', { request_id: requestId, profile: profile.name, error: message }, options.env || process.env).catch(() => {});
      json(res, 502, { error: { type: 'api_error', message } });
    }
  });
  return { server, token, host, port };
}

export async function listenProxy(profile, options = {}) {
  const proxy = await createProxy(profile, options);
  await new Promise((resolve) => proxy.server.listen(proxy.port, proxy.host, resolve));
  const address = proxy.server.address();
  return { ...proxy, url: `http://${proxy.host}:${address.port}` };
}

function validAuth(req, token) {
  const candidates = [req.headers['x-api-key'], req.headers['anthropic-api-key'], req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : req.headers.authorization].filter(Boolean);
  return candidates.some((candidate) => safeEqual(String(candidate), token));
}
function safeEqual(a, b) { const ab = Buffer.from(a); const bb = Buffer.from(b); return ab.length === bb.length && crypto.timingSafeEqual(ab, bb); }
function randomToken() { return `cpk-local-${crypto.randomBytes(32).toString('base64url')}`; }
function readBody(req) { return new Promise((resolve, reject) => { let body=''; let bytes=0; req.setEncoding('utf8'); req.on('data', c => { bytes += Buffer.byteLength(c); if (bytes > MAX_BODY_BYTES) { req.destroy(); reject(new Error('request body too large')); return; } body += c; }); req.on('end', () => resolve(body)); req.on('error', reject); }); }
function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(`${JSON.stringify(data)}\n`); }
async function pipeError(res, upstream) { const text = redact(await upstream.text()); res.writeHead(upstream.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { type: 'upstream_error', status: upstream.status, message: text.slice(0, 2000) } })); }
