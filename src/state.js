import fs from 'node:fs/promises';
import path from 'node:path';
import { stateDir, statePath, logPath } from './paths.js';
import { redact } from './redact.js';

export async function writeState(partial, env = process.env) {
  await fs.mkdir(stateDir(env), { recursive: true, mode: 0o700 });
  const prev = await readState(env).catch(() => ({}));
  const next = { ...prev, ...partial, updated_at: new Date().toISOString() };
  const target = statePath(env);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmp, target);
  try { await fs.chmod(target, 0o600); } catch {}
  return next;
}

export async function readState(env = process.env) {
  return JSON.parse(await fs.readFile(statePath(env), 'utf8'));
}

export async function logEvent(event, data = {}, env = process.env) {
  await fs.mkdir(stateDir(env), { recursive: true, mode: 0o700 });
  const record = { ts: new Date().toISOString(), event, ...JSON.parse(redact(data)) };
  const p = logPath(env);
  await fs.appendFile(p, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  try { await fs.chmod(p, 0o600); } catch {}
  return record;
}
