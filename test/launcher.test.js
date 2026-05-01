import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildClaudeArgs, buildClaudeSettings, readUserStatusLineCommand } from '../src/launcher.js';

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
  assert.equal(settings.env.CGB_DISPLAY_MODEL, 'CGB gateway → gpt-4.1 as claude-opus-4-7');
  assert.equal(settings.sessionName, undefined);
  assert.deepEqual(Object.keys(settings.settings).sort(), ['autoCompactWindow', 'statusLine']);
  assert.equal(settings.settings.statusLine.padding, 0);
  assert.match(settings.settings.statusLine.command, /bin\/cgb\.js' statusline$/);
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
  const args = buildClaudeArgs('/tmp/cgb-claude-abc/settings.json', generated, []);
  assert.deepEqual(args.slice(0, 6), ['--setting-sources', 'project,local', '--settings', '/tmp/cgb-claude-abc/settings.json', '--model', 'opus']);
  assert.equal(args.some((arg) => String(arg).includes('/.claude/settings')), false);
  assert.equal(args.some((arg) => String(arg).includes('.claude/settings')), false);
});

test('launcher can chain an existing user statusline command as CGB base statusline', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cgb-claude-config-'));
  await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'node /tmp/hud.js' } }));
  assert.equal(await readUserStatusLineCommand({ CLAUDE_CONFIG_DIR: dir }), 'node /tmp/hud.js');
  const settings = buildClaudeSettings({ name: 'gateway', visible_model: 'claude-opus-4-7', client_model: 'opus', context_window: 1000000, upstream: { model: 'gpt-4.1' } }, { url: 'http://127.0.0.1:1', token: 'token' }, { CLAUDE_CONFIG_DIR: dir }, { baseStatusLineCommand: await readUserStatusLineCommand({ CLAUDE_CONFIG_DIR: dir }) });
  assert.equal(settings.env.CGB_BASE_STATUSLINE_COMMAND, 'node /tmp/hud.js');
  await fs.rm(dir, { recursive: true, force: true });
});

test('launcher does not recursively chain a CGB statusline command', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cgb-claude-config-'));
  await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: "node '/repo/bin/cgb.js' statusline" } }));
  assert.equal(await readUserStatusLineCommand({ CLAUDE_CONFIG_DIR: dir }), '');
  await fs.rm(dir, { recursive: true, force: true });
});
