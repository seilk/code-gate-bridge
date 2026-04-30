import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { configDir, profilePath, secretsPath, validateProfileName } from './paths.js';
import { resolveProvider } from './providers.js';

const SECRET_TEMPLATE = `# Put provider API keys here. Example:\n# LETSUR_API_KEY=sk-...\n`;

export async function ensureDirs(env = process.env) {
  await fs.mkdir(path.join(configDir(env), 'profiles'), { recursive: true, mode: 0o700 });
  try { await fs.chmod(configDir(env), 0o700); } catch {}
}

export async function initConfig(env = process.env) {
  await ensureDirs(env);
  const secretFile = secretsPath(env);
  if (!fsSync.existsSync(secretFile)) {
    await fs.writeFile(secretFile, SECRET_TEMPLATE, { mode: 0o600 });
  }
  try { await fs.chmod(secretFile, 0o600); } catch {}
  return { configDir: configDir(env), secretsPath: secretFile };
}

export async function writeProfile(profile, env = process.env) {
  validateProfileName(profile.name);
  await ensureDirs(env);
  const normalized = normalizeProfile(profile);
  const p = profilePath(profile.name, env);
  await fs.writeFile(p, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
  try { await fs.chmod(p, 0o600); } catch {}
  return normalized;
}

export async function readProfile(name, env = process.env) {
  validateProfileName(name);
  const p = profilePath(name, env);
  const raw = await fs.readFile(p, 'utf8');
  try { await fs.chmod(p, 0o600); } catch {}
  return normalizeProfile(JSON.parse(raw));
}

export async function listProfiles(env = process.env) {
  await ensureDirs(env);
  const dir = path.join(configDir(env), 'profiles');
  const names = [];
  for (const entry of await fs.readdir(dir)) {
    if (entry.endsWith('.json')) names.push(entry.slice(0, -5));
  }
  return names.sort();
}

export function normalizeProfile(profile) {
  const name = validateProfileName(profile.name);
  const upstream = profile.upstream || {};
  const providerId = profile.provider || upstream.provider || 'openai-compatible';
  const provider = resolveProvider(providerId);
  const capabilities = profile.capabilities || {};
  if (!profile.visible_model) throw new Error('profile.visible_model is required');
  const baseUrl = validateBaseUrl(upstream.base_url || provider.defaultBaseUrl);
  if (!upstream.model) throw new Error('profile.upstream.model is required');
  if (!upstream.api_key_env && !upstream.api_key && !provider.credentialEnv) throw new Error('profile.upstream.api_key_env is required');
  return {
    name,
    provider: provider.id,
    visible_model: String(profile.visible_model),
    context_window: Number(profile.context_window || 200000),
    max_output_tokens: Number(profile.max_output_tokens || 8192),
    upstream: {
      type: upstream.type || provider.transport,
      base_url: baseUrl,
      model: String(upstream.model),
      api_key_env: upstream.api_key_env ? String(upstream.api_key_env) : provider.credentialEnv,
      api_key: upstream.api_key ? String(upstream.api_key) : undefined
    },
    capabilities: normalizeCapabilities(capabilities, provider.capabilities),
    retry: normalizeRetry(profile.retry)
  };
}

function normalizeCapabilities(capabilities = {}, defaults = {}) {
  return {
    streaming: capabilities.streaming ?? defaults.streaming ?? true,
    tools: capabilities.tools ?? defaults.tools ?? true,
    images: capabilities.images ?? defaults.images ?? false,
    thinking: capabilities.thinking ?? defaults.thinking ?? false,
    prompt_cache: capabilities.prompt_cache ?? defaults.prompt_cache ?? false
  };
}

function normalizeRetry(retry = {}) {
  const maxRetries = validateNumber(retry.max_retries ?? 0, 'retry.max_retries', { integer: true, min: 0, max: 5 });
  const baseDelayMs = validateNumber(retry.base_delay_ms ?? 250, 'retry.base_delay_ms', { integer: true, min: 0, max: 30000 });
  return { max_retries: maxRetries, base_delay_ms: baseDelayMs };
}

function validateNumber(value, name, { integer = false, min = -Infinity, max = Infinity } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || (integer && !Number.isInteger(number)) || number < min || number > max) throw new Error(`${name} must be a finite ${integer ? 'integer' : 'number'} between ${min} and ${max}`);
  return number;
}

export function sanitizeProfile(profile) {
  const clone = JSON.parse(JSON.stringify(profile));
  if (clone.upstream?.api_key) clone.upstream.api_key = '[REDACTED]';
  return clone;
}

export function validateBaseUrl(value) {
  if (!value) throw new Error('profile.upstream.base_url is required');
  let url;
  try { url = new URL(String(value)); } catch { throw new Error('profile.upstream.base_url must be a valid URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('profile.upstream.base_url must use http or https');
  if (url.username || url.password) throw new Error('profile.upstream.base_url must not include credentials');
  if (url.search || url.hash) throw new Error('profile.upstream.base_url must not include query or hash');
  return url.toString().replace(/\/+$/, '');
}

export async function loadEnvFile(file) {
  const out = {};
  if (!fsSync.existsSync(file)) return out;
  const raw = await fs.readFile(file, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const idx = normalized.indexOf('=');
    if (idx < 1) continue;
    const key = normalized.slice(0, idx).trim();
    let value = normalized.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

export async function resolveApiKey(profile, env = process.env) {
  if (profile.upstream.api_key) return profile.upstream.api_key;
  const keyName = profile.upstream.api_key_env;
  const fileEnv = await loadEnvFile(secretsPath(env));
  const key = env[keyName] || fileEnv[keyName];
  if (!key) throw new Error(`missing API key env ${keyName}; set it in environment or ${secretsPath(env)}`);
  return key;
}
