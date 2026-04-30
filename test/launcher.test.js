import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClaudeArgs, buildClaudeSettings } from '../src/launcher.js';

test('launcher separates Claude settings from process env and route display', () => {
  const settings = buildClaudeSettings({
    name: 'letsur',
    visible_model: 'claude-opus-4-7',
    client_model: 'opus',
    context_window: 1000000,
    upstream: { model: 'gpt-5.5' }
  }, { url: 'http://127.0.0.1:12345', token: 'local-token' }, {});
  assert.equal(settings.model, 'opus');
  assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN, 'local-token');
  assert.equal(settings.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(settings.env.ANTHROPIC_MODEL, 'opus');
  assert.equal(settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL, undefined);
  assert.equal(settings.env.CPK_DISPLAY_MODEL, 'CPK letsur → gpt-5.5 as claude-opus-4-7');
  assert.equal(settings.sessionName, 'CPK letsur → gpt-5.5 as claude-opus-4-7');
  assert.deepEqual(Object.keys(settings.settings).sort(), ['autoCompactWindow', 'statusLine']);
  assert.equal(settings.settings.statusLine.padding, 0);
  assert.equal(JSON.stringify(settings.settings).includes('ANTHROPIC_AUTH_TOKEN'), false);
});

test('launcher injects route display name unless user supplied one', () => {
  const generated = { model: 'opus', sessionName: 'CPK letsur → gpt-5.5 as claude-opus-4-7' };
  assert.deepEqual(buildClaudeArgs('/tmp/settings.json', generated, ['-p', 'hi']), ['--setting-sources', 'project,local', '--settings', '/tmp/settings.json', '--model', 'opus', '--name', generated.sessionName, '-p', 'hi']);
  assert.deepEqual(buildClaudeArgs('/tmp/settings.json', generated, ['--name', 'mine']), ['--setting-sources', 'project,local', '--settings', '/tmp/settings.json', '--model', 'opus', '--name', 'mine']);
  assert.deepEqual(buildClaudeArgs('/tmp/settings.json', generated, ['--name=mine']), ['--setting-sources', 'project,local', '--settings', '/tmp/settings.json', '--model', 'opus', '--name=mine']);
});
