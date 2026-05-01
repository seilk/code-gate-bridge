#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = process.argv[2] || process.env.CGB_TOOL_PROFILE;
if (!profile) {
  console.error('usage: npm run test:tools -- <profile>');
  process.exit(2);
}

const tmpState = fs.mkdtempSync(path.join(os.tmpdir(), 'cgb-tool-smoke-'));
const cgbBin = path.join(repoRoot, 'bin', 'cgb.js');
const prompt = 'Use the Bash tool to run: pwd. Then answer with exactly TOOL_OK followed by the command output.';
const result = spawnSync(process.execPath, [
  cgbBin,
  profile,
  '-p',
  prompt,
  '--tools',
  'Bash',
  '--allowedTools',
  'Bash',
  '--permission-mode',
  'bypassPermissions',
  '--output-format',
  'stream-json',
  '--verbose'
], {
  cwd: repoRoot,
  env: { ...process.env, CGB_STATE_DIR: tmpState },
  encoding: 'utf8',
  timeout: 120000
});

const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
const capturePath = path.join(os.tmpdir(), `cgb-tool-smoke-${process.pid}.jsonl`);
fs.writeFileSync(capturePath, combined);

if (result.status !== 0) {
  throw new Error(`CGB tool smoke failed with status ${result.status}; capture saved to ${capturePath}`);
}
if (!combined.includes('"type":"tool_use"') || !combined.includes('"name":"Bash"')) {
  throw new Error(`Bash tool_use was not observed; capture saved to ${capturePath}`);
}
if (!combined.includes('"tool_use_result"')) {
  throw new Error(`Claude Code did not execute the Bash tool; capture saved to ${capturePath}`);
}
if (!combined.includes('TOOL_OK') || !combined.includes(repoRoot)) {
  throw new Error(`Final answer did not include TOOL_OK and cwd; capture saved to ${capturePath}`);
}

const eventsPath = path.join(tmpState, 'events.jsonl');
if (fs.existsSync(eventsPath)) {
  const failed = fs.readFileSync(eventsPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((event) => event.event === 'request.failed');
  if (failed.length) {
    throw new Error(`Proxy logged request.failed during tool smoke; capture saved to ${capturePath}; state=${eventsPath}`);
  }
}

console.log(`Tool smoke passed for ${profile}`);
console.log(`Capture: ${capturePath}`);
