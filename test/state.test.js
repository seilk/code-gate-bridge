import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readState, writeState, logEvent } from '../src/state.js';
import { stateDir } from '../src/paths.js';

test('CGB migrates default legacy claude-provider-kit state into code-gate-bridge', async () => {
  const home = await fs.mkdtemp('/tmp/cgb-home-state-migrate-');
  const legacy = path.join(home, '.local', 'state', 'claude-provider-kit');
  const current = path.join(home, '.local', 'state', 'code-gate-bridge');
  await fs.mkdir(legacy, { recursive: true });
  await fs.writeFile(path.join(legacy, 'state.json'), '{"upstream_model":"legacy-model"}\n', { mode: 0o600 });
  await fs.writeFile(path.join(legacy, 'events.jsonl'), '{"event":"legacy"}\n', { mode: 0o600 });

  const env = { HOME: home };
  assert.equal(stateDir(env), current);
  assert.equal((await readState(env)).upstream_model, 'legacy-model');
  await logEvent('new.event', { ok: true }, env);
  const events = await fs.readFile(path.join(current, 'events.jsonl'), 'utf8');
  assert.match(events, /"event":"legacy"/);
  assert.match(events, /"event":"new.event"/);
  await writeState({ active_profile: 'new' }, env);
  assert.equal((await readState(env)).active_profile, 'new');
});
