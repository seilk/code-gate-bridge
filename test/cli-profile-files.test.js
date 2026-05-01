import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const bin = path.resolve('bin/cgb.js');

function run(args, env) {
  return spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
}

test('CLI can create YAML-backed profile and show/export it as YAML', async () => {
  const dir = await fs.mkdtemp('/tmp/cgb-cli-yaml-');
  const env = { CGB_CONFIG_DIR: dir };
  assert.equal(run(['init'], env).status, 0);
  const create = run(['profile', 'create', 'gateway-gpt-4.1', '--base-url', 'https://api.example.com/v1', '--model', 'gpt-4.1', '--key-env', 'CUSTOM_PROVIDER_API_KEY', '--format', 'yaml'], env);
  assert.equal(create.status, 0, create.stderr);
  const stored = await fs.readFile(path.join(dir, 'profiles', 'gateway-gpt-4.1.yaml'), 'utf8');
  assert.match(stored, /provider: openai-compatible/);
  const show = run(['profile', 'show', 'gateway-gpt-4.1', '--format', 'yaml'], env);
  assert.equal(show.status, 0, show.stderr);
  assert.match(show.stdout, /upstream:\n  type: openai-chat-completions/);
  const exported = run(['profile', 'export', 'gateway-gpt-4.1', '--format', 'yaml'], env);
  assert.equal(exported.status, 0, exported.stderr);
  assert.match(exported.stdout, /model: gpt-4\.1/);
});

test('CLI can import a YAML profile and override its name', async () => {
  const dir = await fs.mkdtemp('/tmp/cgb-cli-import-');
  const env = { CGB_CONFIG_DIR: dir };
  const source = path.join(dir, 'source.yaml');
  await fs.writeFile(source, 'name: old\nprovider: openai-compatible\nvisible_model: claude-opus-4-7\nupstream:\n  base_url: https://api.example.com/v1\n  model: gpt-4.1\n  api_key_env: CUSTOM_PROVIDER_API_KEY\n', 'utf8');
  assert.equal(run(['init'], env).status, 0);
  const imported = run(['profile', 'import', source, '--name', 'new', '--format', 'json'], env);
  assert.equal(imported.status, 0, imported.stderr);
  const stored = JSON.parse(await fs.readFile(path.join(dir, 'profiles', 'new.json'), 'utf8'));
  assert.equal(stored.name, 'new');
  assert.equal(stored.provider, 'openai-compatible');
  assert.equal(stored.upstream.model, 'gpt-4.1');
  assert.equal(stored.upstream.base_url, 'https://api.example.com/v1');
});

test('CLI export tightens output file permissions', async () => {
  const dir = await fs.mkdtemp('/tmp/cgb-cli-export-mode-');
  const env = { CGB_CONFIG_DIR: dir };
  const output = path.join(dir, 'export.yaml');
  assert.equal(run(['init'], env).status, 0);
  assert.equal(run(['profile', 'create', 'gateway-gpt-4.1', '--base-url', 'https://api.example.com/v1', '--model', 'gpt-4.1', '--key-env', 'CUSTOM_PROVIDER_API_KEY'], env).status, 0);
  await fs.writeFile(output, 'old', { mode: 0o644 });
  const exported = run(['profile', 'export', 'gateway-gpt-4.1', '--format', 'yaml', '--output', output], env);
  assert.equal(exported.status, 0, exported.stderr);
  const mode = (await fs.stat(output)).mode & 0o777;
  assert.equal(mode, 0o600);
});

test('CLI launches a profile directly without shell aliases or -- separator', async () => {
  const dir = await fs.mkdtemp('/tmp/cgb-cli-direct-profile-');
  const fakeBin = path.join(dir, 'bin');
  const fakeClaude = path.join(fakeBin, 'claude');
  await fs.mkdir(fakeBin);
  await fs.writeFile(fakeClaude, `#!/usr/bin/env node\nconsole.log(JSON.stringify({ argv: process.argv.slice(2), auth: process.env.ANTHROPIC_AUTH_TOKEN ? 'set' : 'missing', apiKey: process.env.ANTHROPIC_API_KEY || null, baseUrl: process.env.ANTHROPIC_BASE_URL || null, display: process.env.CGB_DISPLAY_MODEL || null, baseStatus: process.env.CGB_BASE_STATUSLINE_COMMAND || null }));\n`, { mode: 0o755 });
  const claudeConfig = path.join(dir, 'claude-config');
  await fs.mkdir(claudeConfig);
  await fs.writeFile(path.join(claudeConfig, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'node /tmp/plain-claude-hud.js' } }));
  const env = { CGB_CONFIG_DIR: dir, CLAUDE_CONFIG_DIR: claudeConfig, CGB_SKIP_PREFLIGHT: '1', PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, CUSTOM_PROVIDER_API_KEY: 'test-key' };
  assert.equal(run(['init'], env).status, 0);
  const create = run(['profile', 'create', 'gateway-gpt-4.1', '--base-url', 'https://api.example.com/v1', '--model', 'gpt-4.1', '--key-env', 'CUSTOM_PROVIDER_API_KEY', '--format', 'yaml'], env);
  assert.equal(create.status, 0, create.stderr);
  const launched = run(['gateway-gpt-4.1', '--bare', '-p', 'hi'], env);
  assert.equal(launched.status, 0, launched.stderr);
  const observed = JSON.parse(launched.stdout.trim());
  assert.deepEqual(observed.argv.slice(0, 8), ['--setting-sources', 'user,project,local', '--settings', observed.argv[3], '--model', 'opus', '--bare', '-p']);
  assert.equal(observed.argv.at(-1), 'hi');
  assert.equal(observed.auth, 'set');
  assert.equal(observed.apiKey, null);
  assert.match(observed.baseUrl, /^http:\/\/127\.0\.0\.1:/);
  assert.equal(observed.display, 'CGB gateway-gpt-4.1 → gpt-4.1');
  assert.equal(observed.baseStatus, null);
});
