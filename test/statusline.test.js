import test from 'node:test';
import assert from 'node:assert/strict';
import { renderStatusline } from '../src/statusline.js';

test('statusline overrides model before calling base command', async () => {
  const base = `node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>console.log(JSON.parse(s).model.display_name))'`;
  const out = await renderStatusline(JSON.stringify({ model: { display_name: 'Opus 4.7' } }), { CPK_DISPLAY_MODEL: 'CPK letsur → gpt-5.5 as claude-opus-4-7', CPK_BASE_STATUSLINE_COMMAND: base });
  assert.equal(out.stdout.trim(), 'CPK letsur → gpt-5.5 as claude-opus-4-7');
});

test('statusline default output includes cpk route display', async () => {
  const out = await renderStatusline('{}', { CPK_DISPLAY_MODEL: 'CPK letsur → gpt-5.5 as claude-opus-4-7' });
  assert.equal(out.stdout.trim(), '[CPK letsur → gpt-5.5 as claude-opus-4-7]');
});
