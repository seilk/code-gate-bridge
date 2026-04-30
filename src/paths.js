import os from 'node:os';
import path from 'node:path';

export function configDir(env = process.env) {
  return env.CPK_CONFIG_DIR || path.join(os.homedir(), '.config', 'claude-provider-kit');
}

export function stateDir(env = process.env) {
  return env.CPK_STATE_DIR || path.join(os.homedir(), '.local', 'state', 'claude-provider-kit');
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
