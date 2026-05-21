import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeProfile } from '../src/config.js';
import { restartManagedProxy, startManagedProxy, statusManagedProxy, stopManagedProxy } from '../src/managed-proxy.js';

test('managed proxy can stop and restart on the same URL with the same token', async () => {
  const dir = await fs.mkdtemp('/tmp/cgb-managed-proxy-');
  const env = { CGB_CONFIG_DIR: path.join(dir, 'config'), CGB_STATE_DIR: path.join(dir, 'state'), TEST_KEY: 'test-key' };
  await writeProfile({
    name: 'gateway',
    visible_model: 'claude-opus-4-7',
    upstream: { base_url: 'https://api.example.com/v1', model: 'gpt-4.1', api_key_env: 'TEST_KEY' }
  }, env, { format: 'yaml' });

  try {
    const started = await startManagedProxy('gateway', { env, showToken: true });
    assert.equal(started.running, true);
    assert.match(started.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.match(started.token, /^cgb-managed-/);

    const health = await fetch(`${started.url}/health`);
    assert.deepEqual(await health.json(), { ok: true });

    const hiddenStatus = await statusManagedProxy({ env });
    assert.equal(hiddenStatus.running, true);
    assert.equal(hiddenStatus.token, undefined);

    const stopped = await stopManagedProxy({ env, showToken: true });
    assert.equal(stopped.running, false);
    assert.equal(stopped.url, started.url);
    assert.equal(stopped.token, started.token);

    const restarted = await restartManagedProxy(undefined, { env, showToken: true });
    assert.equal(restarted.running, true);
    assert.equal(restarted.url, started.url);
    assert.equal(restarted.token, started.token);
  } finally {
    await stopManagedProxy({ env }).catch(() => {});
  }
});
