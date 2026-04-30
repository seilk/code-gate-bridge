import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { initConfig, writeProfile, readProfile, readProfileFile, writeProfileFile, formatProfileDocument, parseProfileDocument, listProfiles } from '../src/config.js';

test('profile roundtrip in isolated config dir', async () => {
  const dir = await fs.mkdtemp('/tmp/cpk-config-');
  const env = { CPK_CONFIG_DIR: dir };
  await initConfig(env);
  await writeProfile({ name: 'letsur', visible_model: 'claude-opus-4-7', upstream: { base_url: 'https://gw.letsur.ai/v1', model: 'gpt-5.5', api_key_env: 'LETSUR_API_KEY' } }, env);
  const p = await readProfile('letsur', env);
  assert.equal(p.upstream.model, 'gpt-5.5');
});

test('rejects unsafe profile names', async () => {
  await assert.rejects(() => writeProfile({ name: '../bad', visible_model: 'x', upstream: { base_url: 'https://x', model: 'm', api_key_env: 'K' } }, { CPK_CONFIG_DIR: '/tmp/cpk-x' }), /profile name/);
});

test('rejects invalid retry configuration', async () => {
  await assert.rejects(() => writeProfile({ name: 'bad-retry', visible_model: 'x', upstream: { base_url: 'https://x', model: 'm', api_key_env: 'K' }, retry: { max_retries: 'nope' } }, { CPK_CONFIG_DIR: '/tmp/cpk-x' }), /retry\.max_retries/);
});

test('parses and formats profile YAML safely', () => {
  const yaml = `
name: letsur
provider: letsur
visible_model: claude-opus-4-7
context_window: 1000000
upstream:
  model: gpt-5.5
capabilities:
  tools: true
  thinking: true
retry:
  max_retries: 1
  base_delay_ms: 100
`;
  const parsed = parseProfileDocument(yaml, 'profile.yaml');
  assert.equal(parsed.name, 'letsur');
  assert.equal(parsed.upstream.model, 'gpt-5.5');
  assert.equal(parsed.capabilities.thinking, true);
  const out = formatProfileDocument(parsed, 'yaml');
  assert.match(out, /upstream:\n  model: gpt-5\.5/);
  assert.match(out, /thinking: true/);
});

test('rejects unsupported YAML constructs instead of guessing', () => {
  assert.throws(() => parseProfileDocument('name: [bad]\n', 'profile.yaml'), /unsupported YAML value/);
  assert.throws(() => parseProfileDocument('- bad\n', 'profile.yaml'), /unsupported YAML/);
  assert.throws(() => parseProfileDocument('name: x\nupstream:\n  __proto__:\n    model: hidden\n', 'profile.yaml'), /reserved YAML key/);
});

test('reads and writes profile files in json and yaml', async () => {
  const dir = await fs.mkdtemp('/tmp/cpk-profile-file-');
  const yamlPath = path.join(dir, 'letsur.yaml');
  const jsonPath = path.join(dir, 'letsur-copy.json');
  await fs.writeFile(yamlPath, `name: letsur\nprovider: letsur\nvisible_model: claude-opus-4-7\nupstream:\n  model: gpt-5.5\n`, 'utf8');
  const yamlProfile = await readProfileFile(yamlPath);
  assert.equal(yamlProfile.upstream.base_url, 'https://gw.letsur.ai/v1');
  await writeProfileFile(jsonPath, yamlProfile, 'json');
  const jsonProfile = await readProfileFile(jsonPath);
  assert.equal(jsonProfile.provider, 'letsur');
  assert.equal(jsonProfile.upstream.model, 'gpt-5.5');
});

test('profile store can use yaml as canonical file', async () => {
  const dir = await fs.mkdtemp('/tmp/cpk-yaml-store-');
  const env = { CPK_CONFIG_DIR: dir };
  await initConfig(env);
  await writeProfile({ name: 'yamlprof', provider: 'letsur', visible_model: 'claude-opus-4-7', upstream: { model: 'gpt-5.5' } }, env, { format: 'yaml' });
  assert.equal((await listProfiles(env)).includes('yamlprof'), true);
  const stored = await fs.readFile(path.join(dir, 'profiles', 'yamlprof.yaml'), 'utf8');
  assert.match(stored, /provider: letsur/);
  const profile = await readProfile('yamlprof', env);
  assert.equal(profile.upstream.model, 'gpt-5.5');
});

test('writing a profile in one format removes stale sibling formats', async () => {
  const dir = await fs.mkdtemp('/tmp/cpk-format-switch-');
  const env = { CPK_CONFIG_DIR: dir };
  await initConfig(env);
  await writeProfile({ name: 'switch', visible_model: 'claude-opus-4-7', upstream: { base_url: 'https://old.example/v1', model: 'old', api_key_env: 'OLD_KEY' } }, env);
  await writeProfile({ name: 'switch', provider: 'letsur', visible_model: 'claude-opus-4-7', upstream: { model: 'gpt-5.5' } }, env, { format: 'yaml' });
  await assert.rejects(() => fs.access(path.join(dir, 'profiles', 'switch.json')));
  const profile = await readProfile('switch', env);
  assert.equal(profile.upstream.model, 'gpt-5.5');
  assert.equal(profile.upstream.base_url, 'https://gw.letsur.ai/v1');
});
