import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderStatusline } from '../src/statusline.js';

test('statusline prefixes CGB route before base command output', async () => {
  const base = `printf 'base widgets'`;
  const out = await renderStatusline('{}', { CGB_DISPLAY_MODEL: 'CGB gateway → gpt-4.1', CGB_BASE_STATUSLINE_COMMAND: base });
  assert.equal(out.stdout.trim(), '[CGB gateway → gpt-4.1] base widgets');
});

test('statusline avoids duplicating route when base echoes rewritten model', async () => {
  const base = `node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>console.log(JSON.parse(s).model.display_name))'`;
  const out = await renderStatusline(JSON.stringify({ model: { display_name: 'Opus 4.7' } }), { CGB_DISPLAY_MODEL: 'CGB gateway → gpt-4.1', CGB_BASE_STATUSLINE_COMMAND: base });
  assert.equal(out.stdout.trim(), '[CGB gateway → gpt-4.1]');
});

test('statusline default output includes cgb route display', async () => {
  const out = await renderStatusline('{}', { CGB_DISPLAY_MODEL: 'CGB gateway → gpt-4.1' });
  assert.equal(out.stdout.trim(), '[CGB gateway → gpt-4.1]');
});

test('statusline preserves context window usage when replacing Claude Code statusline', async () => {
  const input = JSON.stringify({
    context_window: {
      total_input_tokens: 125000,
      total_output_tokens: 5000,
      context_window_size: 1000000,
      used_percentage: 13
    }
  });
  const out = await renderStatusline(input, { CGB_DISPLAY_MODEL: 'CGB gateway → gpt-4.1' });
  assert.equal(out.stdout.trim(), '[CGB gateway → gpt-4.1] ctx 13% 130k/1M');
});

test('statusline keeps context window usage with base command output', async () => {
  const input = JSON.stringify({ context_window: { total_input_tokens: 10000, total_output_tokens: 0, context_window_size: 200000 } });
  const out = await renderStatusline(input, { CGB_DISPLAY_MODEL: 'CGB gateway → gpt-4.1', CGB_BASE_STATUSLINE_COMMAND: `printf 'widgets'` });
  assert.equal(out.stdout.trim(), '[CGB gateway → gpt-4.1] ctx 5% 10k/200k widgets');
});

test('statusline wraps multiline user HUD and updates its context bar from Claude input', async () => {
  const input = JSON.stringify({ context_window: { total_input_tokens: 10000, total_output_tokens: 0, context_window_size: 200000 } });
  const base = `printf 'repo\\nContext ░░░░░░░░░░ 0%%'`;
  const out = await renderStatusline(input, { CGB_DISPLAY_MODEL: 'CGB gateway → gpt-4.1', CGB_BASE_STATUSLINE_COMMAND: base });
  assert.equal(out.stdout.trim(), '[CGB gateway → gpt-4.1] repo\nContext █░░░░░░░░░ 5% 10k/200k');
});

test('statusline strips Claude compatibility model badge from chained HUD', async () => {
  const input = JSON.stringify({ context_window: { total_input_tokens: 10000, total_output_tokens: 0, context_window_size: 200000 } });
  const base = `printf '[Opus 4.7] │ repo\\nContext ░░░░░░░░░░ 0%%'`;
  const out = await renderStatusline(input, { CGB_DISPLAY_MODEL: 'CGB letsur-gpt-5.5 → gpt-5.5', CGB_BASE_STATUSLINE_COMMAND: base });
  assert.equal(out.stdout.trim(), '[CGB letsur-gpt-5.5 → gpt-5.5] repo\nContext █░░░░░░░░░ 5% 10k/200k');
});

test('statusline replaces stale base HUD context percentage with latest Claude context_window usage', async () => {
  const input = JSON.stringify({ context_window: { total_input_tokens: 700000, total_output_tokens: 0, context_window_size: 1000000 } });
  const base = `printf 'repo\\nContext ░░░░░░░░░░ 0%%'`;
  const out = await renderStatusline(input, { CGB_DISPLAY_MODEL: 'CGB gateway → gpt-5.5', CGB_BASE_STATUSLINE_COMMAND: base });
  assert.equal(out.stdout.trim(), '[CGB gateway → gpt-5.5] repo\nContext ███████░░░ 70% 700k/1M');
});

test('statusline does not duplicate CGB route when user HUD prints rewritten model', async () => {
  const input = JSON.stringify({ context_window: { total_input_tokens: 10000, total_output_tokens: 0, context_window_size: 200000 } });
  const base = `printf '[CGB gateway → gpt-4.1] │ repo\\nContext █░░░░░░░░░ 5%%'`;
  const out = await renderStatusline(input, { CGB_DISPLAY_MODEL: 'CGB gateway → gpt-4.1', CGB_BASE_STATUSLINE_COMMAND: base });
  assert.equal(out.stdout.trim(), '[CGB gateway → gpt-4.1] │ repo\nContext █░░░░░░░░░ 5% 10k/200k');
});

test('statusline shows zero context usage when Claude Code reports a window size', async () => {
  const input = JSON.stringify({ context_window: { total_input_tokens: 0, total_output_tokens: 0, context_window_size: 1000000 } });
  const out = await renderStatusline(input, { CGB_DISPLAY_MODEL: 'CGB gateway → gpt-4.1' });
  assert.equal(out.stdout.trim(), '[CGB gateway → gpt-4.1] ctx 0% 0/1M');
});

test('statusline HUD bar shows visible fill for small nonzero context usage', async () => {
  const input = JSON.stringify({ context_window: { total_input_tokens: 30075, total_output_tokens: 24, context_window_size: 1000000, used_percentage: 3 } });
  const base = `printf 'repo\\nContext ░░░░░░░░░░ 0%%'`;
  const out = await renderStatusline(input, { CGB_DISPLAY_MODEL: 'CGB gateway → gpt-5.5', CGB_BASE_STATUSLINE_COMMAND: base });
  assert.equal(out.stdout.trim(), '[CGB gateway → gpt-5.5] repo\nContext █░░░░░░░░░ 3% 30.1k/1M');
});

test('statusline falls back to transcript usage when Claude context_window has not repainted yet', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cgb-status-transcript-'));
  const transcript = path.join(dir, 'session.jsonl');
  await fs.writeFile(transcript, [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', usage: { input_tokens: 30063, output_tokens: 6 } } })
  ].join('\n'));
  const input = JSON.stringify({
    transcript_path: transcript,
    context_window: { total_input_tokens: 0, total_output_tokens: 0, context_window_size: 1000000, current_usage: null, used_percentage: null }
  });
  const base = `printf 'repo\\nContext ░░░░░░░░░░ 0%%'`;
  const out = await renderStatusline(input, { CGB_DISPLAY_MODEL: 'CGB gateway → gpt-5.5', CGB_BASE_STATUSLINE_COMMAND: base });
  assert.equal(out.stdout.trim(), '[CGB gateway → gpt-5.5] repo\nContext █░░░░░░░░░ 3% 30.1k/1M');
});

test('statusline does not combine inconsistent reported percentage with cumulative token counts', async () => {
  const input = JSON.stringify({ context_window: { total_input_tokens: 683700, total_output_tokens: 0, context_window_size: 1000000, used_percentage: 12 } });
  const base = `printf 'llmwiki\\nContext ░░░░░░░░░░ 0%%'`;
  const out = await renderStatusline(input, { CGB_DISPLAY_MODEL: 'CGB letsur-gpt-5.5 → gpt-5.5', CGB_BASE_STATUSLINE_COMMAND: base });
  assert.equal(out.stdout.trim(), '[CGB letsur-gpt-5.5 → gpt-5.5] llmwiki\nContext █░░░░░░░░░ 12% reported');
});

test('statusline computes percentage from tokens only when no reported percentage is available', async () => {
  const input = JSON.stringify({ context_window: { total_input_tokens: 683700, total_output_tokens: 0, context_window_size: 1000000, used_percentage: null } });
  const out = await renderStatusline(input, { CGB_DISPLAY_MODEL: 'CGB gateway → gpt-5.5' });
  assert.equal(out.stdout.trim(), '[CGB gateway → gpt-5.5] ctx 68.4% 683.7k/1M');
});
