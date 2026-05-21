import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { readProfile } from './config.js';
import { listenProxy } from './proxy.js';
import { proxyStatePath, stateDir } from './paths.js';
import { logEvent, writeState } from './state.js';

const HOST = '127.0.0.1';
const START_TIMEOUT_MS = 5000;

export async function startManagedProxy(profileName, options = {}) {
  if (!profileName) throw new Error('usage: cgb proxy start <profile>');
  const env = options.env || process.env;
  await readProfile(profileName, env);
  const existing = await readProxyState(env).catch(() => null);
  const current = existing ? await inspectProxyState(existing, options) : null;
  if (current?.running) {
    if (current.profile !== profileName) throw new Error(`managed proxy already running for ${current.profile} at ${current.url}; stop it before starting ${profileName}`);
    return publicProxyState(current, options);
  }

  const seed = {
    ...(existing || {}),
    profile: profileName,
    host: HOST,
    port: Number(options.port || existing?.port || 0),
    token: options.token || existing?.token || randomToken(),
    pid: null,
    status: 'starting',
    started_at: new Date().toISOString()
  };
  await writeProxyState(seed, env);

  const bin = new URL('../bin/cgb.js', import.meta.url).pathname;
  const child = spawn(process.execPath, [bin, 'proxy', 'daemon'], {
    detached: true,
    stdio: 'ignore',
    env
  });
  child.unref();
  const started = await waitForManagedProxy(env, options.startTimeoutMs || START_TIMEOUT_MS);
  return publicProxyState(started, options);
}

export async function stopManagedProxy(options = {}) {
  const env = options.env || process.env;
  const state = await readProxyState(env).catch(() => null);
  if (!state) return { running: false, status: 'missing' };
  if (state.pid && isPidAlive(state.pid)) {
    try { process.kill(state.pid, 'SIGTERM'); } catch {}
    await waitUntilStopped(state, options.stopTimeoutMs || 3000);
  }
  const next = { ...state, pid: null, status: 'stopped', stopped_at: new Date().toISOString() };
  await writeProxyState(next, env);
  return publicProxyState({ ...next, running: false }, options);
}

export async function restartManagedProxy(profileName, options = {}) {
  const env = options.env || process.env;
  const existing = await readProxyState(env).catch(() => null);
  const name = profileName || existing?.profile;
  if (!name) throw new Error('usage: cgb proxy restart [profile]');
  await stopManagedProxy({ ...options, env });
  return startManagedProxy(name, { ...options, env, port: options.port || existing?.port, token: options.token || existing?.token });
}

export async function statusManagedProxy(options = {}) {
  const env = options.env || process.env;
  const state = await readProxyState(env).catch(() => null);
  if (!state) return { running: false, status: 'missing' };
  return publicProxyState(await inspectProxyState(state, options), options);
}

export async function runManagedProxyDaemon(options = {}) {
  const env = options.env || process.env;
  const state = await readProxyState(env);
  if (!state.profile || !state.token) throw new Error('managed proxy state is missing profile or token');
  const profile = await readProfile(state.profile, env);
  const proxy = await listenProxy(profile, { env, host: state.host || HOST, port: state.port || 0, token: state.token });
  const address = proxy.server.address();
  const next = {
    ...state,
    profile: profile.name,
    host: proxy.host,
    port: address.port,
    url: proxy.url,
    pid: process.pid,
    status: 'running',
    started_at: new Date().toISOString()
  };
  await writeProxyState(next, env);
  await writeState({ managed_proxy_profile: profile.name, managed_proxy_url: proxy.url }, env).catch(() => {});
  await logEvent('managed_proxy.started', { profile: profile.name, proxy_url: proxy.url, pid: process.pid }, env).catch(() => {});

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await new Promise((resolve) => proxy.server.close(resolve));
    await writeProxyState({ ...next, pid: null, status: 'stopped', stopped_at: new Date().toISOString() }, env).catch(() => {});
    await logEvent('managed_proxy.stopped', { profile: profile.name, proxy_url: proxy.url, pid: process.pid }, env).catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  await new Promise(() => {});
}

export async function readProxyState(env = process.env) {
  return JSON.parse(await fs.readFile(proxyStatePath(env), 'utf8'));
}

async function writeProxyState(state, env = process.env) {
  await fs.mkdir(stateDir(env), { recursive: true, mode: 0o700 });
  const target = proxyStatePath(env);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmp, target);
  try { await fs.chmod(target, 0o600); } catch {}
  return state;
}

async function inspectProxyState(state, options = {}) {
  const running = await proxyHealthOk(state);
  return { ...state, running, status: running ? 'running' : state.status === 'stopped' ? 'stopped' : 'stale' };
}

async function waitForManagedProxy(env, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await readProxyState(env).catch(() => null);
    if (last && await proxyHealthOk(last)) return { ...last, running: true, status: 'running' };
    await delay(100);
  }
  throw new Error(`managed proxy did not become healthy${last?.url ? ` at ${last.url}` : ''}`);
}

async function waitUntilStopped(state, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!await proxyHealthOk(state)) return;
    await delay(100);
  }
}

async function proxyHealthOk(state) {
  if (!state?.url) return false;
  try {
    const response = await fetch(`${state.url}/health`, { signal: AbortSignal.timeout(500) });
    return response.ok;
  } catch { return false; }
}

function isPidAlive(pid) {
  if (!pid || !Number.isInteger(Number(pid))) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch { return false; }
}

function publicProxyState(state, options = {}) {
  const out = { ...state };
  if (!options.showToken) delete out.token;
  return out;
}

function randomToken() {
  return `cgb-managed-${crypto.randomBytes(32).toString('base64url')}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
