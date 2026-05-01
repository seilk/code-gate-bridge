import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClaudeArgs, buildClaudeSettings } from '../src/launcher.js';

test('launcher separates Claude settings from process env and route display', () => {
  const settings = buildClaudeSettings({
    name: 'gateway',
    visible_model: 'claude-opus-4-7',
    client_model: 'opus',
    context_window: 1000000,
    upstream: { model: 'gpt-4.1' }
  }, { url: 'http://127.0.0.1:12345', token: 'local-token' }, {});
  assert.equal(settings.model, 'opus');
  assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN, 'local-token');
  assert.equal(settings.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(settings.env.ANTHROPIC_MODEL, 'opus');
  assert.equal(settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL, undefined);
  assert.equal(settings.env.CPK_DISPLAY_MODEL, 'CPK gateway → gpt-4.1 as claude-opus-4-7');
  assert.equal(settings.sessionName, undefined);
  assert.deepEqual(Object.keys(settings.settings).sort(), ['autoCompactWindow', 'statusLine']);
  assert.equal(settings.settings.statusLine.padding, 0);
  assert.match(settings.settings.statusLine.command, /bin\/cpk\.js' statusline$/);
  assert.equal(JSON.stringify(settings.settings).includes('ANTHROPIC_AUTH_TOKEN'), false);
});

test('launcher does not hijack Claude Code session name', () => {
  const generated = { model: 'opus' };
  assert.deepEqual(buildClaudeArgs('/tmp/settings.json', generated, ['-p', 'hi']), ['--setting-sources', 'project,local', '--settings', '/tmp/settings.json', '--model', 'opus', '-p', 'hi']);
  assert.deepEqual(buildClaudeArgs('/tmp/settings.json', generated, ['--name', 'mine']), ['--setting-sources', 'project,local', '--settings', '/tmp/settings.json', '--model', 'opus', '--name', 'mine']);
  assert.deepEqual(buildClaudeArgs('/tmp/settings.json', generated, ['--name=mine']), ['--setting-sources', 'project,local', '--settings', '/tmp/settings.json', '--model', 'opus', '--name=mine']);
});

test('launcher uses only per-run settings and does not target persistent Claude settings', () => {
  const generated = { model: 'opus' };
  const args = buildClaudeArgs('/tmp/cpk-claude-abc/settings.json', generated, []);
  assert.deepEqual(args.slice(0, 6), ['--setting-sources', 'project,local', '--settings', '/tmp/cpk-claude-abc/settings.json', '--model', 'opus']);
  assert.equal(args.some((arg) => String(arg).includes('/.claude/settings')), false);
  assert.equal(args.some((arg) => String(arg).includes('.claude/settings')), false);
});
