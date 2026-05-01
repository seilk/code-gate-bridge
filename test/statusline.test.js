import test from 'node:test';
import assert from 'node:assert/strict';
import { renderStatusline } from '../src/statusline.js';

test('statusline prefixes CGB route before base command output', async () => {
  const base = `printf 'base widgets'`;
  const out = await renderStatusline('{}', { CGB_DISPLAY_MODEL: 'CGB gateway → gpt-4.1 as claude-opus-4-7', CGB_BASE_STATUSLINE_COMMAND: base });
  assert.equal(out.stdout.trim(), '[CGB gateway → gpt-4.1 as claude-opus-4-7] base widgets');
});

test('statusline avoids duplicating route when base echoes rewritten model', async () => {
  const base = `node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>console.log(JSON.parse(s).model.display_name))'`;
  const out = await renderStatusline(JSON.stringify({ model: { display_name: 'Opus 4.7' } }), { CGB_DISPLAY_MODEL: 'CGB gateway → gpt-4.1 as claude-opus-4-7', CGB_BASE_STATUSLINE_COMMAND: base });
  assert.equal(out.stdout.trim(), '[CGB gateway → gpt-4.1 as claude-opus-4-7]');
});

test('statusline default output includes cgb route display', async () => {
  const out = await renderStatusline('{}', { CGB_DISPLAY_MODEL: 'CGB gateway → gpt-4.1 as claude-opus-4-7' });
  assert.equal(out.stdout.trim(), '[CGB gateway → gpt-4.1 as claude-opus-4-7]');
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
  const out = await renderStatusline(input, { CGB_DISPLAY_MODEL: 'CGB gateway → gpt-4.1 as claude-opus-4-7' });
  assert.equal(out.stdout.trim(), '[CGB gateway → gpt-4.1 as claude-opus-4-7] ctx 13% 130k/1M');
});

test('statusline keeps context window usage with base command output', async () => {
  const input = JSON.stringify({ context_window: { total_input_tokens: 10000, total_output_tokens: 0, context_window_size: 200000 } });
  const out = await renderStatusline(input, { CGB_DISPLAY_MODEL: 'CGB gateway → gpt-4.1 as claude-opus-4-7', CGB_BASE_STATUSLINE_COMMAND: `printf 'widgets'` });
  assert.equal(out.stdout.trim(), '[CGB gateway → gpt-4.1 as claude-opus-4-7] ctx 5% 10k/200k widgets');
});

test('statusline wraps multiline user HUD without dropping its context bar', async () => {
  const input = JSON.stringify({ context_window: { total_input_tokens: 10000, total_output_tokens: 0, context_window_size: 200000 } });
  const base = `printf '[Opus 4.7] │ repo\\nContext █░░░░░░░░░ 5%%'`;
  const out = await renderStatusline(input, { CGB_DISPLAY_MODEL: 'CGB gateway → gpt-4.1 as claude-opus-4-7', CGB_BASE_STATUSLINE_COMMAND: base });
  assert.equal(out.stdout.trim(), '[CGB gateway → gpt-4.1 as claude-opus-4-7] [Opus 4.7] │ repo\nContext █░░░░░░░░░ 5%');
});

test('statusline does not duplicate CGB route when user HUD prints rewritten model', async () => {
  const input = JSON.stringify({ context_window: { total_input_tokens: 10000, total_output_tokens: 0, context_window_size: 200000 } });
  const base = `printf '[CGB gateway → gpt-4.1 as claude-opus-4-7] │ repo\\nContext █░░░░░░░░░ 5%%'`;
  const out = await renderStatusline(input, { CGB_DISPLAY_MODEL: 'CGB gateway → gpt-4.1 as claude-opus-4-7', CGB_BASE_STATUSLINE_COMMAND: base });
  assert.equal(out.stdout.trim(), '[CGB gateway → gpt-4.1 as claude-opus-4-7] │ repo\nContext █░░░░░░░░░ 5%');
});

test('statusline shows zero context usage when Claude Code reports a window size', async () => {
  const input = JSON.stringify({ context_window: { total_input_tokens: 0, total_output_tokens: 0, context_window_size: 1000000 } });
  const out = await renderStatusline(input, { CGB_DISPLAY_MODEL: 'CGB gateway → gpt-4.1 as claude-opus-4-7' });
  assert.equal(out.stdout.trim(), '[CGB gateway → gpt-4.1 as claude-opus-4-7] ctx 0% 0/1M');
});
