import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP_DIR = 'code-gate-bridge';
const LEGACY_APP_DIR = 'claude-provider-kit';

export function configDir(env = process.env) {
  if (env.CGB_CONFIG_DIR) return env.CGB_CONFIG_DIR;
  if (env.CPK_CONFIG_DIR) return env.CPK_CONFIG_DIR;
  const current = path.join(os.homedir(), '.config', APP_DIR);
  const legacy = path.join(os.homedir(), '.config', LEGACY_APP_DIR);
  if (!fs.existsSync(current) && fs.existsSync(legacy)) return legacy;
  return current;
}

export function stateDir(env = process.env) {
  return env.CGB_STATE_DIR || env.CPK_STATE_DIR || path.join(os.homedir(), '.local', 'state', APP_DIR);
}

export function profilePath(name, env = process.env, extension = 'json') {
  const ext = String(extension).replace(/^\./, '');
  return path.join(configDir(env), 'profiles', `${name}.${ext}`);
}

export function secretsPath(env = process.env) {
  return path.join(configDir(env), 'secrets.env');
}

export function statePath(env = process.env) {
  return path.join(stateDir(env), 'state.json');
}

export function logPath(env = process.env) {
  return path.join(stateDir(env), 'events.jsonl');
}

export function validateProfileName(name) {
  if (!/^[A-Za-z0-9._-]+$/.test(name || '')) {
    throw new Error('profile name must match ^[A-Za-z0-9._-]+$');
  }
  return name;
}
