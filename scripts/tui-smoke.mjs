#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = process.argv[2] || 'letsur-gpt-5.5';
const expected = process.env.CPK_TUI_EXPECTED || 'CPK_TUI_SMOKE_OK';
const session = `cpk_tui_smoke_${process.pid}`;
const capturePath = path.join(os.tmpdir(), `${session}.txt`);
const cpkBin = path.join(repoRoot, 'bin', 'cpk.js');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  return result;
}

function requireCommand(command) {
  const result = run('/bin/sh', ['-lc', `command -v ${shellQuote(command)} >/dev/null 2>&1`]);
  if (result.status !== 0) throw new Error(`required command not found: ${command}`);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function capture() {
  const result = run('tmux', ['capture-pane', '-t', session, '-p', '-S', '-', '-E', '-']);
  return result.stdout || '';
}

async function waitFor(predicate, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    last = capture();
    if (predicate(last)) return last;
    await sleep(500);
  }
  fs.writeFileSync(capturePath, last);
  throw new Error(`timed out waiting for ${label}; capture saved to ${capturePath}`);
}

function assertScreen(screen, needle, label = needle) {
  if (!screen.includes(needle)) {
    fs.writeFileSync(capturePath, screen);
    throw new Error(`missing ${label}; capture saved to ${capturePath}`);
  }
}

function occurrenceCount(text, needle) {
  return text.split(needle).length - 1;
}

try {
  requireCommand('tmux');
  requireCommand('claude');
  run('tmux', ['kill-session', '-t', session]);

  const launch = `${shellQuote(process.execPath)} ${shellQuote(cpkBin)} ${shellQuote(profile)}`;
  const start = run('tmux', ['new-session', '-d', '-s', session, '-x', '160', '-y', '44', `cd ${shellQuote(repoRoot)} && ${launch}`]);
  if (start.status !== 0) throw new Error(start.stderr || start.stdout || 'failed to start tmux session');

  const routePrefix = `CPK ${profile} →`;
  const initial = await waitFor((screen) => screen.includes(routePrefix) || screen.includes('custom API key'), 'CPK statusline');
  if (initial.includes('custom API key')) {
    fs.writeFileSync(capturePath, initial);
    throw new Error(`Claude Code showed custom API key prompt; capture saved to ${capturePath}`);
  }
  assertScreen(initial, routePrefix, 'CPK route statusline');

  run('tmux', ['send-keys', '-t', session, `Reply exactly ${expected}`, 'Enter']);
  const finalScreen = await waitFor((screen) => occurrenceCount(screen, expected) >= 2, 'assistant reply', 60000);
  assertScreen(finalScreen, routePrefix, 'CPK route statusline after reply');
  if (occurrenceCount(finalScreen, expected) < 2) {
    fs.writeFileSync(capturePath, finalScreen);
    throw new Error(`expected assistant reply not observed; capture saved to ${capturePath}`);
  }

  fs.writeFileSync(capturePath, finalScreen);
  console.log(`TUI smoke passed for ${profile}`);
  console.log(`Capture: ${capturePath}`);
} finally {
  run('tmux', ['kill-session', '-t', session]);
}
