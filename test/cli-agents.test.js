import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const bin = path.resolve('bin/cgb.js');

async function makeFakeClaude(dir) {
  const fakeBin = path.join(dir, 'bin');
  await fs.mkdir(fakeBin);
  const fakeClaude = path.join(fakeBin, 'claude');
  await fs.writeFile(
    fakeClaude,
    `#!/usr/bin/env node\nconsole.log(JSON.stringify({ argv: process.argv.slice(2), env: { base: process.env.ANTHROPIC_BASE_URL || null, auth: process.env.ANTHROPIC_AUTH_TOKEN || null, display: process.env.CGB_DISPLAY_MODEL || null } }));\n`,
    { mode: 0o755 }
  );
  return fakeBin;
}

function run(args, env) {
  return spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
}

test('cgb agents forwards to claude agents without proxy or anthropic env injection', async () => {
  const dir = await fs.mkdtemp('/tmp/cgb-cli-agents-');
  const fakeBin = await makeFakeClaude(dir);
  const env = { CGB_CONFIG_DIR: dir, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, ANTHROPIC_BASE_URL: '', ANTHROPIC_AUTH_TOKEN: '', CGB_DISPLAY_MODEL: '' };
  const result = run(['agents'], env);
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout.trim());
  assert.deepEqual(observed.argv, ['agents']);
  assert.deepEqual(observed.env, { base: null, auth: null, display: null });
});

test('cgb agents forwards extra flags as claude agents arguments', async () => {
  const dir = await fs.mkdtemp('/tmp/cgb-cli-agents-args-');
  const fakeBin = await makeFakeClaude(dir);
  const env = { CGB_CONFIG_DIR: dir, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };
  const result = run(['agents', '--cwd', '/tmp/repo', '--add-dir', '/tmp/other'], env);
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout.trim());
  assert.deepEqual(observed.argv, ['agents', '--cwd', '/tmp/repo', '--add-dir', '/tmp/other']);
});

test('cgb agents respects CGB_CLAUDE_BIN override', async () => {
  const dir = await fs.mkdtemp('/tmp/cgb-cli-agents-bin-');
  const customBin = path.join(dir, 'my-claude');
  await fs.writeFile(
    customBin,
    `#!/usr/bin/env node\nconsole.log(JSON.stringify({ via: 'custom', argv: process.argv.slice(2) }));\n`,
    { mode: 0o755 }
  );
  const env = { CGB_CONFIG_DIR: dir, CGB_CLAUDE_BIN: customBin };
  const result = run(['agents', '--bg', 'task'], env);
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout.trim());
  assert.equal(observed.via, 'custom');
  assert.deepEqual(observed.argv, ['agents', '--bg', 'task']);
});

test('cgb agents surfaces a clear error when claude is not on PATH', async () => {
  const dir = await fs.mkdtemp('/tmp/cgb-cli-agents-missing-');
  const emptyBin = path.join(dir, 'bin');
  await fs.mkdir(emptyBin);
  const env = { CGB_CONFIG_DIR: dir, PATH: emptyBin, CGB_CLAUDE_BIN: '' };
  const result = run(['agents'], env);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cgb: /);
  assert.match(result.stderr, /claude/);
});

test('cgb agents propagates non-zero exit code from claude', async () => {
  const dir = await fs.mkdtemp('/tmp/cgb-cli-agents-exit-');
  const fakeBin = path.join(dir, 'bin');
  await fs.mkdir(fakeBin);
  await fs.writeFile(
    path.join(fakeBin, 'claude'),
    `#!/usr/bin/env node\nprocess.exit(7);\n`,
    { mode: 0o755 }
  );
  const env = { CGB_CONFIG_DIR: dir, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };
  const result = run(['agents'], env);
  assert.equal(result.status, 7);
});
