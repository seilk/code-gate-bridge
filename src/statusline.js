import { spawnSync } from 'node:child_process';
import { readState } from './state.js';
import { stripControls } from './redact.js';

export async function renderStatusline(input, env = process.env) {
  const display = truncate(env.CGB_DISPLAY_MODEL || env.CPK_DISPLAY_MODEL || env.CCS_DISPLAY_MODEL || await observedModel(env));
  const status = parseStatusInput(input);
  const context = renderContextSegment(status?.context_window);
  let forwarded = input;
  if (display && status) {
    const data = { ...status };
    data.model = { ...(data.model && typeof data.model === 'object' ? data.model : {}), display_name: stripControls(display), id: stripControls(display) };
    forwarded = JSON.stringify(data);
  }
  const base = env.CGB_BASE_STATUSLINE_COMMAND || env.CPK_BASE_STATUSLINE_COMMAND || env.CCS_BASE_STATUSLINE_COMMAND;
  if (base) {
    const depth = Number(env.CGB_STATUSLINE_DEPTH || 0);
    if (depth > 2) return { stdout: '[cgb: statusline recursion]\n', stderr: '', status: 0 };
    const result = spawnSync('/bin/bash', ['-lc', base], { input: forwarded, encoding: 'utf8', env: { ...process.env, ...env, CGB_STATUSLINE_DEPTH: String(depth + 1) }, maxBuffer: 1024 * 1024, timeout: Number(env.CGB_STATUSLINE_TIMEOUT_MS || 1000) });
    if (result.error) return { stdout: `[cgb: statusline ${result.error.code || 'error'}]\n`, stderr: '', status: 0 };
    return { stdout: mergeStatusline(display, result.stdout, context), stderr: result.stderr || '', status: result.status ?? 0 };
  }
  const model = display || 'cgb: no route observed';
  return { stdout: mergeStatusline(model, '', context), stderr: '', status: 0 };
}

async function observedModel(env) {
  try {
    const state = await readState(env);
    return state.upstream_model ? `${state.active_profile || 'upstream'}/${state.upstream_model}` : '';
  } catch { return ''; }
}
function truncate(value) { return stripControls(String(value || '')).slice(0, 80); }

function mergeStatusline(display, baseOutput = '', context = '') {
  const cleanDisplay = stripControls(String(display || '')).trim();
  const rawBaseLines = String(baseOutput || '').split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim());
  const contextReplacement = context ? contextLineForBase(context) : '';
  const baseHadContext = rawBaseLines.some((line) => isContextLine(line));
  const baseLines = contextReplacement ? rawBaseLines.map((line) => replaceContextLine(line, contextReplacement, context)) : rawBaseLines;
  const firstLine = baseLines[0] || '';
  const remainingLines = baseLines.slice(1);
  const parts = [];
  const cleanFirstLine = stripControls(firstLine).trim();
  const prefix = `[${cleanDisplay}]`;
  const baseHasDisplay = cleanDisplay && baseLines.some((line) => stripControls(line).includes(cleanDisplay));
  if (cleanDisplay && (!baseHasDisplay || cleanFirstLine === cleanDisplay || cleanFirstLine === prefix)) parts.push(prefix);
  if (context && !baseHadContext) parts.push(context);
  if (cleanFirstLine && cleanFirstLine !== cleanDisplay && cleanFirstLine !== prefix && cleanFirstLine !== context) parts.push(firstLine.trim());
  const lines = [parts.join(' '), ...remainingLines].filter((line) => line.trim());
  return `${lines.join('\n')}\n`;
}

function isContextLine(line) {
  return /\b(Context|ctx)[:\s]/i.test(stripControls(line));
}

function replaceContextLine(line, hudContext, compactContext) {
  const clean = stripControls(line).trim();
  if (/^ctx\b/i.test(clean)) return compactContext;
  if (/^Context\b/i.test(clean)) return hudContext;
  return line;
}

function contextLineForBase(context) {
  const match = String(context).match(/^ctx\s+([^\s]+)(?:\s+(.+))?$/i);
  if (!match) return context;
  const pctText = match[1];
  const tokensText = match[2] || '';
  const pct = Number.parseFloat(pctText);
  const filled = Number.isFinite(pct) ? Math.max(0, Math.min(10, Math.round(pct / 10))) : 0;
  const bar = `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`;
  return `Context ${bar} ${pctText}${tokensText ? ` ${tokensText}` : ''}`;
}

function parseStatusInput(input) {
  try {
    const parsed = JSON.parse(input || '{}');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

function renderContextSegment(context) {
  if (!context || typeof context !== 'object') return '';
  const pct = numeric(context.used_percentage ?? context.current_usage);
  const inputTokens = numeric(context.total_input_tokens);
  const outputTokens = numeric(context.total_output_tokens);
  const windowSize = numeric(context.context_window_size);
  const usedTokens = inputTokens + outputTokens;
  const usedPct = Number.isFinite(pct) ? pct : (windowSize > 0 ? (usedTokens / windowSize) * 100 : NaN);
  if (!Number.isFinite(usedPct) && !usedTokens && !windowSize) return '';
  const pctText = Number.isFinite(usedPct) ? `${Math.max(0, Math.min(100, usedPct)).toFixed(1).replace(/\.0$/, '')}%` : '?%';
  const tokensText = windowSize ? `${formatTokens(usedTokens)}/${formatTokens(windowSize)}` : '';
  return tokensText ? `ctx ${pctText} ${tokensText}` : `ctx ${pctText}`;
}

function numeric(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function formatTokens(value) {
  if (!Number.isFinite(value) || value < 0) return '?';
  if (value === 0) return '0';
  if (value >= 1000000) return `${Number((value / 1000000).toFixed(1)).toString()}M`;
  if (value >= 1000) return `${Number((value / 1000).toFixed(1)).toString()}k`;
  return String(Math.round(value));
}

export async function statuslineMain() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => input += c);
  process.stdin.on('end', async () => {
    const out = await renderStatusline(input, process.env);
    if (out.stdout) process.stdout.write(out.stdout);
    if (out.stderr) process.stderr.write(out.stderr);
    process.exit(out.status);
  });
}
