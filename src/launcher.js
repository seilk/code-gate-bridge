import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readProfile } from './config.js';
import { listenProxy, preflightUpstream } from './proxy.js';
import { shellQuote } from './shell.js';

export async function runClaude(profileName, args = [], options = {}) {
  const env = options.env || process.env;
  const profile = await readProfile(profileName, env);
  if (options.preflight !== false && env.CGB_SKIP_PREFLIGHT !== '1') await preflightUpstream(profile, env);
  const proxy = await listenProxy(profile, { env });
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cgb-claude-'));
  const settingsPath = path.join(tmp, 'settings.json');
  const baseStatusLineCommand = options.baseStatusLineCommand ?? (env.CGB_CHAIN_BASE_STATUSLINE === '1' ? await readUserStatusLineCommand(env) : '');
  const generated = buildClaudeSettings(profile, proxy, env, { baseStatusLineCommand });
  await fs.writeFile(settingsPath, `${JSON.stringify(generated.settings, null, 2)}\n`, { mode: 0o600 });
  return await new Promise((resolve, reject) => {
    const cleanup = async () => { proxy.server.close(); await fs.rm(tmp, { recursive: true, force: true }); };
    const child = spawn(options.claudeBin || 'claude', buildClaudeArgs(settingsPath, generated, args), { stdio: 'inherit', env: { ...env, ...generated.env } });
    child.on('error', async (error) => { await cleanup(); reject(error); });
    child.on('exit', async (code) => { await cleanup(); resolve(code || 0); });
  });
}

export function buildClaudeSettings(profile, proxy, env = process.env, options = {}) {
  const statuslineScript = new URL('../bin/cgb.js', import.meta.url).pathname;
  const baseStatus = env.CGB_BASE_STATUSLINE_COMMAND || env.CPK_BASE_STATUSLINE_COMMAND || env.CCS_BASE_STATUSLINE_COMMAND || options.baseStatusLineCommand || '';
  const claudeModelSelector = env.CGB_CLAUDE_MODEL_SELECTOR || env.CPK_CLAUDE_MODEL_SELECTOR || profile.client_model || 'opus';
  const routeDisplay = routeLabel(profile);
  return {
    env: {
      ANTHROPIC_BASE_URL: proxy.url,
      ANTHROPIC_AUTH_TOKEN: proxy.token,
      ANTHROPIC_MODEL: claudeModelSelector,
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(profile.context_window),
      CGB_DISPLAY_MODEL: routeDisplay,
      ...(profile.reasoning_effort ? { CGB_PROFILE_EFFORT: String(profile.reasoning_effort) } : {}),
      CGB_BASE_STATUSLINE_COMMAND: baseStatus
    },
    model: claudeModelSelector,
    settings: {
      autoCompactWindow: profile.context_window,
      statusLine: { type: 'command', command: `node ${shellQuote(statuslineScript)} statusline`, padding: 0 }
    }
  };
}

export function buildClaudeArgs(settingsPath, generated, userArgs = []) {
  return ['--setting-sources', 'user,project,local', '--settings', settingsPath, '--model', generated.model, ...userArgs];
}

export async function readUserStatusLineCommand(env = process.env) {
  const configDir = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const settingsPath = path.join(configDir, 'settings.json');
  try {
    const data = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    const command = data?.statusLine?.type === 'command' ? data.statusLine.command : '';
    if (typeof command !== 'string' || !command.trim()) return '';
    if ((command.includes('cgb.js') || command.includes('cpk.js')) && command.includes('statusline')) return '';
    return command;
  } catch { return ''; }
}

function routeLabel(profile) {
  const upstream = profile.upstream?.model || 'upstream';
  return `CGB ${profile.name} → ${upstream}`;
}
