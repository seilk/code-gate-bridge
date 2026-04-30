import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const bin = path.resolve('bin/cpk.js');

function run(args, env) {
  return spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
}

test('CLI can create YAML-backed profile and show/export it as YAML', async () => {
  const dir = await fs.mkdtemp('/tmp/cpk-cli-yaml-');
  const env = { CPK_CONFIG_DIR: dir };
  assert.equal(run(['init'], env).status, 0);
  const create = run(['profile', 'create', 'letsur', '--provider', 'letsur', '--model', 'gpt-5.5', '--format', 'yaml'], env);
  assert.equal(create.status, 0, create.stderr);
  const stored = await fs.readFile(path.join(dir, 'profiles', 'letsur.yaml'), 'utf8');
  assert.match(stored, /provider: letsur/);
  const show = run(['profile', 'show', 'letsur', '--format', 'yaml'], env);
  assert.equal(show.status, 0, show.stderr);
  assert.match(show.stdout, /upstream:\n  type: openai-chat-completions/);
  const exported = run(['profile', 'export', 'letsur', '--format', 'yaml'], env);
  assert.equal(exported.status, 0, exported.stderr);
  assert.match(exported.stdout, /model: gpt-5\.5/);
});

test('CLI can import a YAML profile and override its name', async () => {
  const dir = await fs.mkdtemp('/tmp/cpk-cli-import-');
  const env = { CPK_CONFIG_DIR: dir };
  const source = path.join(dir, 'source.yaml');
  await fs.writeFile(source, 'name: old\nprovider: letsur\nvisible_model: claude-opus-4-7\nupstream:\n  model: gpt-5.5\n', 'utf8');
  assert.equal(run(['init'], env).status, 0);
  const imported = run(['profile', 'import', source, '--name', 'new', '--format', 'json'], env);
  assert.equal(imported.status, 0, imported.stderr);
  const stored = JSON.parse(await fs.readFile(path.join(dir, 'profiles', 'new.json'), 'utf8'));
  assert.equal(stored.name, 'new');
  assert.equal(stored.provider, 'letsur');
  assert.equal(stored.upstream.model, 'gpt-5.5');
});

test('CLI export tightens output file permissions', async () => {
  const dir = await fs.mkdtemp('/tmp/cpk-cli-export-mode-');
  const env = { CPK_CONFIG_DIR: dir };
  const output = path.join(dir, 'export.yaml');
  assert.equal(run(['init'], env).status, 0);
  assert.equal(run(['profile', 'create', 'letsur', '--provider', 'letsur', '--model', 'gpt-5.5'], env).status, 0);
  await fs.writeFile(output, 'old', { mode: 0o644 });
  const exported = run(['profile', 'export', 'letsur', '--format', 'yaml', '--output', output], env);
  assert.equal(exported.status, 0, exported.stderr);
  const mode = (await fs.stat(output)).mode & 0o777;
  assert.equal(mode, 0o600);
});
