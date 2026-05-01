import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { stateDir, statePath, logPath, legacyStateDir } from './paths.js';
import { redact } from './redact.js';

export async function writeState(partial, env = process.env) {
  await migrateLegacyState(env);
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
  await migrateLegacyState(env);
  return JSON.parse(await fs.readFile(statePath(env), 'utf8'));
}

export async function logEvent(event, data = {}, env = process.env) {
  await migrateLegacyState(env);
  await fs.mkdir(stateDir(env), { recursive: true, mode: 0o700 });
  const record = { ts: new Date().toISOString(), event, ...JSON.parse(redact(data)) };
  const p = logPath(env);
  await fs.appendFile(p, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  try { await fs.chmod(p, 0o600); } catch {}
  return record;
}

async function migrateLegacyState(env = process.env) {
  if (env.CGB_STATE_DIR || env.CPK_STATE_DIR) return;
  const current = stateDir(env);
  const legacy = legacyStateDir(env);
  if (!fsSync.existsSync(legacy)) return;
  await fs.mkdir(current, { recursive: true, mode: 0o700 });
  await fs.cp(legacy, current, { recursive: true, force: false, errorOnExist: false });
  try { await fs.chmod(current, 0o700); } catch {}
  for (const file of ['state.json', 'events.jsonl']) {
    try { await fs.chmod(path.join(current, file), 0o600); } catch {}
  }
}
