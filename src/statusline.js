import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readState } from './state.js';
import { stripControls } from './redact.js';

export async function renderStatusline(input, env = process.env) {
  const display = truncate(env.CGB_DISPLAY_MODEL || env.CPK_DISPLAY_MODEL || env.CCS_DISPLAY_MODEL || await observedModel(env));
  const status = parseStatusInput(input);
  const context = renderContextSegment(await contextWindowForStatus(status));
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
  const effort = profileEffortSegment(env);
  return { stdout: mergeStatusline(model, cgbDefaultHud(status, effort), context), stderr: '', status: 0 };
}

async function observedModel(env) {
  try {
    const state = await readState(env);
    return state.upstream_model ? `${state.active_profile || 'upstream'}/${state.upstream_model}` : '';
  } catch { return ''; }
}
function truncate(value) { return stripControls(String(value || '')).slice(0, 80); }

function cgbDefaultHud(status, effort = '') {
  const cwd = status?.workspace?.current_dir || status?.cwd || '';
  const repo = cwd ? path.basename(String(cwd)) : '';
  const branch = status?.gitBranch || status?.git_branch || status?.workspace?.git_branch || '';
  const suffix = [effort, repo, branch ? `git:(${stripControls(String(branch))})` : ''].filter(Boolean).join(' ');
  return suffix ? `│ ${suffix}` : '';
}

function profileEffortSegment(env) {
  const effort = truncate(env.CGB_PROFILE_EFFORT || env.CPK_PROFILE_EFFORT || '');
  return effort ? `profile-effort:${effort}` : '';
}

function mergeStatusline(display, baseOutput = '', context = '') {
  const cleanDisplay = stripControls(String(display || '')).trim();
  const rawBaseLines = String(baseOutput || '').split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim());
  const contextReplacement = context ? contextLineForBase(context) : '';
  const normalizedBaseLines = rawBaseLines.map((line) => stripCompatibilityModelBadge(line));
  const baseHadContext = normalizedBaseLines.some((line) => isContextLine(line));
  const baseLines = contextReplacement ? normalizedBaseLines.map((line) => replaceContextLine(line, contextReplacement, context)) : normalizedBaseLines;
  const firstLine = baseLines[0] || '';
  const remainingLines = baseLines.slice(1);
  const parts = [];
  const cleanFirstLine = stripControls(firstLine).trim();
  const prefix = `[${cleanDisplay}]`;
  const baseHasDisplay = cleanDisplay && baseLines.some((line) => stripControls(line).includes(cleanDisplay));
  if (cleanDisplay && (!baseHasDisplay || cleanFirstLine === cleanDisplay || cleanFirstLine === prefix)) parts.push(prefix);
  if (cleanFirstLine && cleanFirstLine !== cleanDisplay && cleanFirstLine !== prefix && cleanFirstLine !== context) parts.push(firstLine.trim());
  if (context && !baseHadContext) parts.push(context);
  const lines = [parts.join(' '), ...remainingLines].filter((line) => line.trim());
  return `${lines.join('\n')}\n`;
}

function stripCompatibilityModelBadge(line) {
  const clean = stripControls(line).trim();
  const match = clean.match(/^\[(?!CGB\b)(?:Opus|Sonnet|Haiku|Claude)\b[^\]]*\]\s*(?:[│|]\s*)?(.*)$/i);
  return match ? match[1] : line;
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
  let filled = 0;
  if (Number.isFinite(pct)) {
    const clamped = Math.max(0, Math.min(100, pct));
    filled = clamped > 0 ? Math.max(1, Math.round(clamped / 10)) : 0;
  }
  const bar = `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`;
  return `Context ${bar} ${pctText}${tokensText ? ` ${tokensText}` : ''}`;
}

function parseStatusInput(input) {
  try {
    const parsed = JSON.parse(input || '{}');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

async function contextWindowForStatus(status) {
  const context = status?.context_window;
  if (hasContextUsage(context)) return context;
  const transcriptUsage = await latestTranscriptUsage(status?.transcript_path);
  if (!transcriptUsage) return context;
  const windowSize = numeric(context?.context_window_size);
  const inputTokens = numeric(transcriptUsage.input_tokens) || 0;
  const outputTokens = numeric(transcriptUsage.output_tokens) || 0;
  const usedTokens = inputTokens + outputTokens;
  const usedPct = Number.isFinite(windowSize) && windowSize > 0 ? (usedTokens / windowSize) * 100 : NaN;
  return {
    ...(context && typeof context === 'object' ? context : {}),
    total_input_tokens: inputTokens,
    total_output_tokens: outputTokens,
    ...(Number.isFinite(windowSize) && windowSize > 0 ? { context_window_size: windowSize } : {}),
    ...(Number.isFinite(usedPct) ? { used_percentage: usedPct } : {})
  };
}

function hasContextUsage(context) {
  if (!context || typeof context !== 'object') return false;
  const pct = numeric(context.used_percentage ?? context.current_usage);
  const inputTokens = numeric(context.total_input_tokens);
  const outputTokens = numeric(context.total_output_tokens);
  return (Number.isFinite(pct) && pct > 0) || (Number.isFinite(inputTokens) && inputTokens > 0) || (Number.isFinite(outputTokens) && outputTokens > 0);
}

async function latestTranscriptUsage(transcriptPath) {
  if (typeof transcriptPath !== 'string' || !transcriptPath) return null;
  try {
    const stat = await fs.stat(transcriptPath);
    const length = Math.min(stat.size, 262144);
    const handle = await fs.open(transcriptPath, 'r');
    try {
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, stat.size - length);
      const lines = buffer.toString('utf8').split(/\r?\n/).reverse();
      for (const line of lines) {
        if (!line.trim()) continue;
        let entry;
        try { entry = JSON.parse(line); } catch { continue; }
        const usage = entry?.message?.usage;
        if (entry?.type === 'assistant' && usage && typeof usage === 'object') return usage;
      }
    } finally {
      await handle.close();
    }
  } catch { return null; }
  return null;
}

function renderContextSegment(context) {
  if (!context || typeof context !== 'object') return '';
  const reportedPct = numeric(context.used_percentage ?? context.current_usage);
  const inputTokens = numeric(context.total_input_tokens);
  const outputTokens = numeric(context.total_output_tokens);
  const windowSize = numeric(context.context_window_size);
  const usedTokens = safeTokenSum(inputTokens, outputTokens);
  const tokenPct = Number.isFinite(usedTokens) && windowSize > 0 ? (usedTokens / windowSize) * 100 : NaN;
  const usedPct = Number.isFinite(reportedPct) ? reportedPct : tokenPct;
  if (!Number.isFinite(usedPct) && !Number.isFinite(usedTokens) && !windowSize) return '';
  const pctText = Number.isFinite(usedPct) ? `${Math.max(0, Math.min(100, usedPct)).toFixed(1).replace(/\.0$/, '')}%` : '?%';
  const canTrustTokenFraction = Number.isFinite(tokenPct) && (!Number.isFinite(reportedPct) || percentagesAgree(reportedPct, tokenPct));
  const tokensText = canTrustTokenFraction && windowSize ? `${formatTokens(usedTokens)}/${formatTokens(windowSize)}` : '';
  const sourceText = Number.isFinite(reportedPct) && !canTrustTokenFraction ? 'reported' : '';
  const detail = tokensText || sourceText;
  return detail ? `ctx ${pctText} ${detail}` : `ctx ${pctText}`;
}

function safeTokenSum(inputTokens, outputTokens) {
  const input = Number.isFinite(inputTokens) ? inputTokens : 0;
  const output = Number.isFinite(outputTokens) ? outputTokens : 0;
  const hasAny = Number.isFinite(inputTokens) || Number.isFinite(outputTokens);
  return hasAny ? input + output : NaN;
}

function percentagesAgree(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= Math.max(2, Math.abs(a) * 0.1);
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
