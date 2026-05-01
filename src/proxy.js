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
  const timeoutMs = Number(options.timeoutMs || env.CGB_UPSTREAM_TIMEOUT_MS || env.CPK_UPSTREAM_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const server = http.createServer(async (req, res) => {
    let requestId = crypto.randomUUID();
    try {
      const pathname = new URL(req.url || '/', `http://${host}`).pathname;
      if (req.method === 'GET' && pathname === '/health') return json(res, 200, { ok: true });
      if ((req.method === 'HEAD' || req.method === 'OPTIONS') && pathname === '/v1/messages') {
        if (!validAuth(req, token)) return json(res, 401, { error: { type: 'authentication_error', message: 'missing or invalid local proxy token' } });
        return noContent(res, { Allow: 'POST, HEAD, OPTIONS' });
      }
      if (req.method === 'GET' && pathname === '/v1/models') {
        if (!validAuth(req, token)) return json(res, 401, { error: { type: 'authentication_error', message: 'missing or invalid local proxy token' } });
        return json(res, 200, { object: 'list', data: modelList(profile).map((id) => ({ id, object: 'model', owned_by: 'code-gate-bridge' })) });
      }
      if (req.method !== 'POST' || pathname !== '/v1/messages') return json(res, 404, { error: { type: 'not_found', message: 'not found' } });
      if (!validAuth(req, token)) return json(res, 401, { error: { type: 'authentication_error', message: 'missing or invalid local proxy token' } });
      const raw = await readBody(req);
      const anthropic = JSON.parse(raw || '{}');
      const upstreamBody = anthropicToOpenAI(anthropic, profile);
      requestId = `cgb_${crypto.randomUUID()}`;
      await writeState({ attempted_request_id: requestId, active_profile: profile.name, visible_model: profile.visible_model, attempted_upstream_model: profile.upstream.model, proxy_url: currentProxyUrl(host, server) }, env);
      await logEvent('request.forward', { request_id: requestId, profile: profile.name, visible_model: profile.visible_model, upstream_model: profile.upstream.model, upstream_base_url: profile.upstream.base_url }, env);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let upstream;
      try {
        upstream = await fetchWithRetry(profile, upstreamBody, apiKey, controller.signal);
      } finally {
        clearTimeout(timer);
      }
      await logEvent('response.received', { request_id: requestId, status: upstream.status, upstream_model: profile.upstream.model }, env);
      if (!upstream.ok) return pipeError(res, upstream);
      await writeState({ last_successful_request_id: requestId, active_profile: profile.name, visible_model: profile.visible_model, upstream_model: profile.upstream.model, upstream_base_url: profile.upstream.base_url, proxy_url: currentProxyUrl(host, server), last_success_at: new Date().toISOString() }, env);
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

async function fetchWithRetry(profile, upstreamBody, apiKey, signal) {
  const maxRetries = Math.max(0, Number(profile.retry?.max_retries || 0));
  const baseDelayMs = Math.max(0, Number(profile.retry?.base_delay_ms ?? 250));
  let attempt = 0;
  while (true) {
    const response = await fetch(`${profile.upstream.base_url}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(upstreamBody), signal });
    if (response.status !== 429 || attempt >= maxRetries || upstreamBody.stream) return response;
    const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
    await response.arrayBuffer().catch(() => {});
    await delay(retryAfter ?? baseDelayMs * (2 ** attempt), signal);
    attempt += 1;
  }
}

function parseRetryAfter(value) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

function delay(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('upstream request timed out')); }, { once: true });
  });
}

export async function listenProxy(profile, options = {}) {
  const proxy = await createProxy(profile, options);
  await new Promise((resolve) => proxy.server.listen(proxy.port, proxy.host, resolve));
  const address = proxy.server.address();
  return { ...proxy, url: `http://${proxy.host}:${address.port}` };
}

function modelList(profile) {
  return [...new Set([profile.client_model || 'opus', profile.visible_model].filter(Boolean))];
}

function currentProxyUrl(host, server) { const address = server.address(); return address?.port ? `http://${host}:${address.port}` : undefined; }
function validAuth(req, token) {
  const candidates = [req.headers['x-api-key'], req.headers['anthropic-api-key'], req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : req.headers.authorization].filter(Boolean);
  return candidates.some((candidate) => safeEqual(String(candidate), token));
}
function safeEqual(a, b) { const ab = Buffer.from(a); const bb = Buffer.from(b); return ab.length === bb.length && crypto.timingSafeEqual(ab, bb); }
function randomToken() { return `cgb-local-${crypto.randomBytes(32).toString('base64url')}`; }
function readBody(req) { return new Promise((resolve, reject) => { let body=''; let bytes=0; req.setEncoding('utf8'); req.on('data', c => { bytes += Buffer.byteLength(c); if (bytes > MAX_BODY_BYTES) { req.destroy(); reject(new Error('request body too large')); return; } body += c; }); req.on('end', () => resolve(body)); req.on('error', reject); }); }
function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(`${JSON.stringify(data)}\n`); }
function noContent(res, headers = {}) { res.writeHead(204, headers); res.end(); }
async function pipeError(res, upstream) { const text = redact(await upstream.text()); res.writeHead(upstream.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { type: 'upstream_error', status: upstream.status, message: text.slice(0, 2000) } })); }
