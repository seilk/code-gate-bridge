import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClaudeSettings } from '../src/launcher.js';

test('launcher uses Claude Code model selector instead of upstream compatibility model', () => {
  const settings = buildClaudeSettings({
    name: 'letsur',
    visible_model: 'claude-opus-4-7',
    context_window: 1000000,
    upstream: { model: 'gpt-5.5' }
  }, { url: 'http://127.0.0.1:12345', token: 'local-token' }, {});
  assert.equal(settings.model, 'opus');
  assert.equal(settings.env.ANTHROPIC_MODEL, 'opus');
  assert.equal(settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'opus');
  assert.equal(settings.env.CPK_DISPLAY_MODEL, 'letsur/gpt-5.5');
  assert.equal(JSON.stringify(settings).includes('claude-opus-4-7'), false);
});
