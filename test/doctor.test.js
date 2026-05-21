import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { writeProfile } from '../src/config.js';
import { doctor } from '../src/doctor.js';

test('doctor flags known provider base URLs that would miss the OpenAI path prefix', async () => {
  const dir = await fs.mkdtemp('/tmp/cgb-doctor-base-url-');
  const env = { CGB_CONFIG_DIR: dir, LETSUR_API_KEY: 'test-key' };
  await writeProfile({
    name: 'letsur-root',
    visible_model: 'claude-opus-4-7',
    upstream: { base_url: 'https://gw.letsur.ai', model: 'gpt-5.5', api_key_env: 'LETSUR_API_KEY' }
  }, env, { format: 'yaml' });

  const checks = await doctor('letsur-root', env);
  const endpoint = checks.find((check) => check.name === 'upstream_chat_completions_endpoint');
  assert.equal(endpoint.ok, false);
  assert.match(endpoint.detail, /base_url for letsur should be https:\/\/gw\.letsur\.ai\/v1/);
  assert.match(endpoint.detail, /current endpoint would be https:\/\/gw\.letsur\.ai\/chat\/completions/);
});

test('doctor reports the computed OpenAI Chat Completions endpoint for valid profiles', async () => {
  const dir = await fs.mkdtemp('/tmp/cgb-doctor-endpoint-');
  const env = { CGB_CONFIG_DIR: dir, LETSUR_API_KEY: 'test-key' };
  await writeProfile({
    name: 'letsur-preset',
    provider: 'letsur',
    visible_model: 'claude-opus-4-7',
    upstream: { model: 'gpt-5.5' }
  }, env, { format: 'yaml' });

  const checks = await doctor('letsur-preset', env);
  const endpoint = checks.find((check) => check.name === 'upstream_chat_completions_endpoint');
  assert.equal(endpoint.ok, true);
  assert.equal(endpoint.detail, 'https://gw.letsur.ai/v1/chat/completions');
});
