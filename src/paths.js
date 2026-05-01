import os from 'node:os';
import path from 'node:path';

const APP_DIR = 'code-gate-bridge';
const LEGACY_APP_DIR = 'claude-provider-kit';

export function homeDir(env = process.env) {
  return env.CGB_HOME || env.HOME || os.homedir();
}

export function currentConfigDir(env = process.env) {
  return path.join(homeDir(env), '.config', APP_DIR);
}

export function legacyConfigDir(env = process.env) {
  return path.join(homeDir(env), '.config', LEGACY_APP_DIR);
}

export function currentStateDir(env = process.env) {
  return path.join(homeDir(env), '.local', 'state', APP_DIR);
}

export function legacyStateDir(env = process.env) {
  return path.join(homeDir(env), '.local', 'state', LEGACY_APP_DIR);
}

export function configDir(env = process.env) {
  if (env.CGB_CONFIG_DIR) return env.CGB_CONFIG_DIR;
  if (env.CPK_CONFIG_DIR) return env.CPK_CONFIG_DIR;
  return currentConfigDir(env);
}

export function stateDir(env = process.env) {
  return env.CGB_STATE_DIR || env.CPK_STATE_DIR || currentStateDir(env);
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
