import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { initConfig, writeProfile, readProfile } from '../src/config.js';

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
