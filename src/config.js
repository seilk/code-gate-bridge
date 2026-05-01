import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { configDir, legacyConfigDir, profilePath, secretsPath, validateProfileName } from './paths.js';
import { resolveProvider } from './providers.js';

const SECRET_TEMPLATE = `# Put provider API keys here. Example:\n# CUSTOM_PROVIDER_API_KEY=...\n`;

export async function ensureDirs(env = process.env) {
  await migrateLegacyConfig(env);
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

export async function writeProfile(profile, env = process.env, options = {}) {
  validateProfileName(profile.name);
  await ensureDirs(env);
  const normalized = normalizeProfile(profile);
  const format = normalizeProfileFormat(options.format || 'json');
  const p = profilePath(profile.name, env, format === 'yaml' ? 'yaml' : 'json');
  await removeSiblingProfileFiles(profile.name, env, p);
  await fs.writeFile(p, formatProfileDocument(normalized, format), { mode: 0o600 });
  try { await fs.chmod(p, 0o600); } catch {}
  return normalized;
}

export async function readProfile(name, env = process.env) {
  validateProfileName(name);
  await migrateLegacyConfig(env);
  const p = await resolveStoredProfilePath(name, env);
  const raw = await fs.readFile(p, 'utf8');
  try { await fs.chmod(p, 0o600); } catch {}
  return normalizeProfile(parseProfileDocument(raw, p));
}

export async function listProfiles(env = process.env) {
  await ensureDirs(env);
  const dir = path.join(configDir(env), 'profiles');
  const names = [];
  for (const entry of await fs.readdir(dir)) {
    const match = entry.match(/^(.+)\.(json|ya?ml)$/i);
    if (match) names.push(match[1]);
  }
  return [...new Set(names)].sort();
}

export async function readProfileFile(file) {
  const raw = await fs.readFile(file, 'utf8');
  return normalizeProfile(parseProfileDocument(raw, file));
}

export async function writeProfileFile(file, profile, format = formatFromPath(file)) {
  const normalized = normalizeProfile(profile);
  await fs.writeFile(file, formatProfileDocument(normalized, format), { mode: 0o600 });
  try { await fs.chmod(file, 0o600); } catch {}
  return normalized;
}

async function resolveStoredProfilePath(name, env) {
  const candidates = [profilePath(name, env, 'json'), profilePath(name, env, 'yaml'), profilePath(name, env, 'yml')];
  for (const candidate of candidates) if (fsSync.existsSync(candidate)) return candidate;
  return candidates[0];
}

async function removeSiblingProfileFiles(name, env, keepPath) {
  const candidates = [profilePath(name, env, 'json'), profilePath(name, env, 'yaml'), profilePath(name, env, 'yml')];
  await Promise.all(candidates.filter((candidate) => candidate !== keepPath).map((candidate) => fs.unlink(candidate).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  })));
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
    client_model: String(profile.client_model || 'opus'),
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

export function parseProfileDocument(content, file = 'profile.json') {
  const format = formatFromPath(file);
  if (format === 'json') return JSON.parse(content);
  return parseSimpleYaml(content);
}

export function formatProfileDocument(profile, format = 'json') {
  const normalized = normalizeProfileFormat(format);
  if (normalized === 'json') return `${JSON.stringify(profile, null, 2)}\n`;
  return `${formatYamlValue(profile, 0)}`;
}

export function formatFromPath(file) {
  const ext = path.extname(String(file)).toLowerCase();
  if (ext === '.yaml' || ext === '.yml') return 'yaml';
  if (ext === '.json' || !ext) return 'json';
  throw new Error('profile file must end with .json, .yaml, or .yml');
}

function normalizeProfileFormat(format) {
  const value = String(format).toLowerCase();
  if (value === 'yml') return 'yaml';
  if (value !== 'json' && value !== 'yaml') throw new Error('profile format must be json or yaml');
  return value;
}

function parseSimpleYaml(content) {
  const root = Object.create(null);
  const stack = [{ indent: -1, value: root }];
  const lines = String(content).split(/\r?\n/);
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const raw = lines[lineNumber];
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const indent = raw.match(/^ */)[0].length;
    if (indent % 2 !== 0) throw new Error(`unsupported YAML indentation at line ${lineNumber + 1}`);
    const line = stripYamlComment(raw.slice(indent)).trimEnd();
    if (!line) continue;
    if (line.startsWith('- ')) throw new Error(`unsupported YAML sequence at line ${lineNumber + 1}`);
    const match = line.match(/^([A-Za-z0-9_.-]+):(.*)$/);
    if (!match) throw new Error(`unsupported YAML at line ${lineNumber + 1}`);
    while (stack.at(-1).indent >= indent) stack.pop();
    const parent = stack.at(-1).value;
    const key = match[1];
    rejectReservedYamlKey(key, lineNumber + 1);
    const rest = match[2].trim();
    if (!rest) {
      const child = Object.create(null);
      parent[key] = child;
      stack.push({ indent, value: child });
    } else {
      parent[key] = parseYamlScalar(rest, lineNumber + 1);
    }
  }
  return root;
}

function stripYamlComment(value) {
  let quote;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if ((ch === '"' || ch === "'") && value[i - 1] !== '\\') quote = quote === ch ? undefined : quote || ch;
    if (ch === '#' && !quote && (i === 0 || /\s/.test(value[i - 1]))) return value.slice(0, i);
  }
  return value;
}

function rejectReservedYamlKey(key, lineNumber) {
  if (key === '__proto__' || key === 'prototype' || key === 'constructor') throw new Error(`reserved YAML key at line ${lineNumber}`);
}

function parseYamlScalar(value, lineNumber) {
  if (value.startsWith('[') || value.startsWith('{') || value.includes('&') || value.includes('*')) throw new Error(`unsupported YAML value at line ${lineNumber}`);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function formatYamlValue(value, indent) {
  const pad = ' '.repeat(indent);
  const lines = [];
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      lines.push(`${pad}${key}:`);
      lines.push(formatYamlValue(item, indent + 2).trimEnd());
    } else {
      lines.push(`${pad}${key}: ${formatYamlScalar(item)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function formatYamlScalar(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (value === null) return 'null';
  const text = String(value);
  if (!text || /^[\s]|[\s]$/.test(text) || /[:#\n\r\[\]{}&,*>!|%@`]/.test(text)) return JSON.stringify(text);
  return text;
}

async function migrateLegacyConfig(env = process.env) {
  if (env.CGB_CONFIG_DIR || env.CPK_CONFIG_DIR) return;
  const current = configDir(env);
  const legacy = legacyConfigDir(env);
  if (!fsSync.existsSync(legacy)) return;
  await fs.mkdir(current, { recursive: true, mode: 0o700 });
  await fs.cp(legacy, current, { recursive: true, force: false, errorOnExist: false });
  try { await fs.chmod(current, 0o700); } catch {}
  try { await fs.chmod(path.join(current, 'secrets.env'), 0o600); } catch {}
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
  await migrateLegacyConfig(env);
  const fileEnv = await loadEnvFile(secretsPath(env));
  const key = env[keyName] || fileEnv[keyName];
  if (!key) throw new Error(`missing API key env ${keyName}; set it in environment or ${secretsPath(env)}`);
  return key;
}
