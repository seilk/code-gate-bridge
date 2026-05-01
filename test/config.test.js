import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { initConfig, writeProfile, readProfile, readProfileFile, writeProfileFile, formatProfileDocument, parseProfileDocument, listProfiles } from '../src/config.js';

test('profile roundtrip in isolated config dir', async () => {
  const dir = await fs.mkdtemp('/tmp/cgb-config-');
  const env = { CGB_CONFIG_DIR: dir };
  await initConfig(env);
  await writeProfile({ name: 'gateway-gpt-4.1', visible_model: 'claude-opus-4-7', upstream: { base_url: 'https://api.example.com/v1', model: 'gpt-4.1', api_key_env: 'CUSTOM_PROVIDER_API_KEY' } }, env);
  const p = await readProfile('gateway-gpt-4.1', env);
  assert.equal(p.provider, 'openai-compatible');
  assert.equal(p.upstream.model, 'gpt-4.1');
});

test('CGB can read profiles from legacy CPK_CONFIG_DIR during rename transition', async () => {
  const dir = await fs.mkdtemp('/tmp/cgb-legacy-config-');
  const env = { CPK_CONFIG_DIR: dir };
  await initConfig(env);
  await writeProfile({ name: 'legacy', visible_model: 'claude-opus-4-7', upstream: { base_url: 'https://api.example.com/v1', model: 'gpt-4.1', api_key_env: 'CUSTOM_PROVIDER_API_KEY' } }, env);
  const p = await readProfile('legacy', env);
  assert.equal(p.upstream.model, 'gpt-4.1');
  assert.deepEqual(await listProfiles(env), ['legacy']);
});

test('rejects unsafe profile names', async () => {
  await assert.rejects(() => writeProfile({ name: '../bad', visible_model: 'x', upstream: { base_url: 'https://x', model: 'm', api_key_env: 'K' } }, { CGB_CONFIG_DIR: '/tmp/cgb-x' }), /profile name/);
});

test('rejects invalid retry configuration', async () => {
  await assert.rejects(() => writeProfile({ name: 'bad-retry', visible_model: 'x', upstream: { base_url: 'https://x', model: 'm', api_key_env: 'K' }, retry: { max_retries: 'nope' } }, { CGB_CONFIG_DIR: '/tmp/cgb-x' }), /retry\.max_retries/);
});

test('parses and formats profile YAML safely', () => {
  const yaml = `
name: gateway-gpt-4.1
provider: openai-compatible
visible_model: claude-opus-4-7
context_window: 200000
upstream:
  base_url: https://api.example.com/v1
  model: gpt-4.1
  api_key_env: CUSTOM_PROVIDER_API_KEY
capabilities:
  tools: true
  thinking: false
retry:
  max_retries: 1
  base_delay_ms: 100
`;
  const parsed = parseProfileDocument(yaml, 'profile.yaml');
  assert.equal(parsed.name, 'gateway-gpt-4.1');
  assert.equal(parsed.upstream.model, 'gpt-4.1');
  assert.equal(parsed.capabilities.thinking, false);
  const out = formatProfileDocument(parsed, 'yaml');
  assert.match(out, /upstream:\n  base_url: "https:\/\/api\.example\.com\/v1"\n  model: gpt-4\.1/);
  assert.match(out, /thinking: false/);
});

test('rejects unsupported YAML constructs instead of guessing', () => {
  assert.throws(() => parseProfileDocument('name: [bad]\n', 'profile.yaml'), /unsupported YAML value/);
  assert.throws(() => parseProfileDocument('- bad\n', 'profile.yaml'), /unsupported YAML/);
  assert.throws(() => parseProfileDocument('name: x\nupstream:\n  __proto__:\n    model: hidden\n', 'profile.yaml'), /reserved YAML key/);
});

test('reads and writes profile files in json and yaml', async () => {
  const dir = await fs.mkdtemp('/tmp/cgb-profile-file-');
  const yamlPath = path.join(dir, 'gateway.yaml');
  const jsonPath = path.join(dir, 'gateway-copy.json');
  await fs.writeFile(yamlPath, `name: gateway\nprovider: openai-compatible\nvisible_model: claude-opus-4-7\nupstream:\n  base_url: https://api.example.com/v1\n  model: gpt-4.1\n  api_key_env: CUSTOM_PROVIDER_API_KEY\n`, 'utf8');
  const yamlProfile = await readProfileFile(yamlPath);
  assert.equal(yamlProfile.upstream.base_url, 'https://api.example.com/v1');
  await writeProfileFile(jsonPath, yamlProfile, 'json');
  const jsonProfile = await readProfileFile(jsonPath);
  assert.equal(jsonProfile.provider, 'openai-compatible');
  assert.equal(jsonProfile.upstream.model, 'gpt-4.1');
});

test('profile store can use yaml as canonical file', async () => {
  const dir = await fs.mkdtemp('/tmp/cgb-yaml-store-');
  const env = { CGB_CONFIG_DIR: dir };
  await initConfig(env);
  await writeProfile({ name: 'yamlprof', visible_model: 'claude-opus-4-7', upstream: { base_url: 'https://api.example.com/v1', model: 'gpt-4.1', api_key_env: 'CUSTOM_PROVIDER_API_KEY' } }, env, { format: 'yaml' });
  assert.equal((await listProfiles(env)).includes('yamlprof'), true);
  const stored = await fs.readFile(path.join(dir, 'profiles', 'yamlprof.yaml'), 'utf8');
  assert.match(stored, /provider: openai-compatible/);
  const profile = await readProfile('yamlprof', env);
  assert.equal(profile.upstream.model, 'gpt-4.1');
});

test('writing a profile in one format removes stale sibling formats', async () => {
  const dir = await fs.mkdtemp('/tmp/cgb-format-switch-');
  const env = { CGB_CONFIG_DIR: dir };
  await initConfig(env);
  await writeProfile({ name: 'switch', visible_model: 'claude-opus-4-7', upstream: { base_url: 'https://old.example/v1', model: 'old', api_key_env: 'OLD_KEY' } }, env);
  await writeProfile({ name: 'switch', visible_model: 'claude-opus-4-7', upstream: { base_url: 'https://api.example.com/v1', model: 'gpt-4.1', api_key_env: 'CUSTOM_PROVIDER_API_KEY' } }, env, { format: 'yaml' });
  await assert.rejects(() => fs.access(path.join(dir, 'profiles', 'switch.json')));
  const profile = await readProfile('switch', env);
  assert.equal(profile.upstream.model, 'gpt-4.1');
  assert.equal(profile.upstream.base_url, 'https://api.example.com/v1');
});
