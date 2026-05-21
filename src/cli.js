import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { initConfig, writeProfile, listProfiles, readProfile, sanitizeProfile, formatProfileDocument, readProfileFile } from './config.js';
import { listenProxy } from './proxy.js';
import { doctor, routeTest } from './doctor.js';
import { readState } from './state.js';
import { runClaude } from './launcher.js';
import { statuslineMain } from './statusline.js';
import { listProviders } from './providers.js';
import { restartManagedProxy, runManagedProxyDaemon, startManagedProxy, statusManagedProxy, stopManagedProxy } from './managed-proxy.js';

const help = `code-gate-bridge (cgb)

Commands:
  init
  profile create <name> --base-url URL --model MODEL --key-env ENV [--visible-model MODEL] [--reasoning-effort LEVEL]
  profile create <name> --provider ID --model MODEL [--key-env ENV] [--visible-model MODEL] [--reasoning-effort LEVEL] [--format json|yaml]
  profile list
  profile show <name> [--format json|yaml]
  profile export <name> [--format json|yaml] [--output FILE]
  profile import <file> [--name NAME] [--format json|yaml]
  providers
  serve <profile> [--port PORT] [--show-token]
  proxy start <profile> [--port PORT] [--show-token]
  proxy stop
  proxy restart [profile] [--port PORT] [--show-token]
  proxy status [--show-token]
  run <profile> [claude args]
  run --managed-proxy <profile> [claude args]
  <profile> [claude args]       Launch a profile directly, e.g. cgb gateway-gpt-4.1 --bare
  agents [claude args]          Open Claude Code Agent View (forwards to 'claude agents';
                                set CGB_CLAUDE_BIN to override the resolved claude binary)
  doctor <profile>
  route-test <profile> [--prompt TEXT]
  status
  statusline
`;

export async function main(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '--help' || cmd === '-h') return console.log(help);
  if (cmd === 'statusline') return statuslineMain();
  if (cmd === 'init') { const r = await initConfig(); console.log(`Initialized ${r.configDir}`); return; }
  if (cmd === 'profile') return profileCommand(rest);
  if (cmd === 'providers') return providersCommand();
  if (cmd === 'serve') return serveCommand(rest);
  if (cmd === 'proxy') return proxyCommand(rest);
  if (cmd === 'run') return runCommand(rest);
  if (cmd === 'doctor') return doctorCommand(rest);
  if (cmd === 'route-test') return routeTestCommand(rest);
  if (cmd === 'status') return statusCommand();
  if (cmd === 'agents') return agentsCommand(rest);
  if (!cmd.startsWith('-') && await profileExists(cmd)) return runCommand([cmd, ...rest]);
  throw new Error(`unknown command or profile: ${cmd}\n${help}`);
}

export async function agentsCommand(argv = [], options = {}) {
  const claudeBin = options.claudeBin || process.env.CGB_CLAUDE_BIN || 'claude';
  const env = options.env || process.env;
  const stdio = options.stdio || 'inherit';
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(claudeBin, ['agents', ...argv], { stdio, env });
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function profileCommand(argv) {
  const [sub, name, ...rest] = argv;
  if (sub === 'list') { for (const p of await listProfiles()) console.log(p); return; }
  if (sub === 'show') return showProfileCommand(name, rest);
  if (sub === 'export') return exportProfileCommand(name, rest);
  if (sub === 'import') return importProfileCommand(name, rest);
  if (sub !== 'create') throw new Error('usage: cgb profile create <name> --base-url URL --model MODEL --key-env ENV [--visible-model MODEL] [--reasoning-effort LEVEL]');
  const opts = parseFlags(rest, new Set(['base-url', 'provider', 'model', 'key-env', 'visible-model', 'context-window', 'max-output-tokens', 'reasoning-effort', 'format']));
  if (!opts.provider && !opts['base-url']) throw new Error('missing --base-url or --provider');
  const profile = await writeProfile({ name, provider: opts.provider, visible_model: opts['visible-model'] || 'claude-opus-4-7', context_window: opts['context-window'] || 200000, max_output_tokens: opts['max-output-tokens'] || 8192, ...(opts['reasoning-effort'] ? { reasoning_effort: opts['reasoning-effort'] } : {}), upstream: { base_url: opts['base-url'], model: required(opts, 'model'), api_key_env: opts['key-env'] } }, process.env, { format: opts.format || 'json' });
  console.log(`Created profile ${profile.name}`);
}

async function showProfileCommand(name, argv) {
  if (!name) throw new Error('usage: cgb profile show <name> [--format json|yaml]');
  const opts = parseFlags(argv, new Set(['format']));
  const format = opts.format || 'json';
  process.stdout.write(formatProfileDocument(sanitizeProfile(await readProfile(name)), format));
}

async function exportProfileCommand(name, argv) {
  if (!name) throw new Error('usage: cgb profile export <name> [--format json|yaml] [--output FILE]');
  const opts = parseFlags(argv, new Set(['format', 'output']));
  const text = formatProfileDocument(sanitizeProfile(await readProfile(name)), opts.format || 'json');
  if (opts.output) {
    await fs.writeFile(opts.output, text, { mode: 0o600 });
    await fs.chmod(opts.output, 0o600).catch(() => {});
  } else process.stdout.write(text);
}

async function importProfileCommand(file, argv) {
  if (!file) throw new Error('usage: cgb profile import <file> [--name NAME] [--format json|yaml]');
  const opts = parseFlags(argv, new Set(['name', 'format']));
  const imported = await readProfileFile(file);
  const profile = { ...imported, name: opts.name || imported.name };
  await writeProfile(profile, process.env, { format: opts.format || 'json' });
  console.log(`Imported profile ${profile.name}`);
}

function providersCommand() {
  for (const provider of listProviders()) {
    console.log(`${provider.id}\t${provider.transport}\t${provider.credentialEnv || '(none)'}\t${provider.defaultBaseUrl || '(custom)'}`);
  }
}

async function serveCommand(argv) {
  const [name, ...rest] = argv; if (!name) throw new Error('usage: cgb serve <profile> [--port PORT] [--show-token]');
  const opts = parseFlags(rest, new Set(['port', 'show-token'])); const profile = await readProfile(name);
  const proxy = await listenProxy(profile, { port: opts.port || 0 });
  console.log(`Serving ${name}: ${proxy.url}${opts['show-token'] ? ` token=${proxy.token}` : ' (token hidden; use --show-token if needed)'}`);
}
async function proxyCommand(argv) {
  const [sub, ...rest] = argv;
  if (sub === 'daemon') return runManagedProxyDaemon();
  if (sub === 'status') {
    const opts = parseFlags(rest, new Set(['show-token']));
    console.log(JSON.stringify(await statusManagedProxy({ showToken: opts['show-token'] }), null, 2));
    return;
  }
  if (sub === 'stop') {
    console.log(JSON.stringify(await stopManagedProxy(), null, 2));
    return;
  }
  if (sub === 'start') {
    const [name, ...flags] = rest; if (!name) throw new Error('usage: cgb proxy start <profile> [--port PORT] [--show-token]');
    const opts = parseFlags(flags, new Set(['port', 'show-token']));
    console.log(JSON.stringify(await startManagedProxy(name, { port: opts.port, showToken: opts['show-token'] }), null, 2));
    return;
  }
  if (sub === 'restart') {
    const [maybeName, ...flags] = rest;
    const name = maybeName && !maybeName.startsWith('--') ? maybeName : undefined;
    const opts = parseFlags(name ? flags : rest, new Set(['port', 'show-token']));
    console.log(JSON.stringify(await restartManagedProxy(name, { port: opts.port, showToken: opts['show-token'] }), null, 2));
    return;
  }
  throw new Error('usage: cgb proxy start|stop|restart|status');
}
async function runCommand(argv) {
  const parsed = parseRunArgs(argv);
  if (!parsed.name) throw new Error('usage: cgb run [--managed-proxy] <profile> [claude args]');
  process.exitCode = await runClaude(parsed.name, normalizeClaudeArgs(parsed.args), { managedProxy: parsed.managedProxy });
}
async function doctorCommand(argv) { const [name] = argv; for (const c of await doctor(name)) console.log(`${c.ok ? 'OK' : 'FAIL'} ${c.name}: ${c.detail}`); }
async function routeTestCommand(argv) { const [name, ...rest] = argv; const opts = parseFlags(rest, new Set(['prompt'])); console.log(JSON.stringify(await routeTest(name, opts.prompt), null, 2)); }
async function statusCommand() { console.log(JSON.stringify(await readState().catch(() => ({ ok: false, message: 'no state yet' })), null, 2)); }
async function profileExists(name) { return (await listProfiles()).includes(name); }
function parseRunArgs(argv) {
  const cleaned = [];
  let managedProxy;
  let separator = false;
  for (const arg of argv) {
    if (!separator && arg === '--') { separator = true; cleaned.push(arg); continue; }
    if (!separator && arg === '--managed-proxy') { managedProxy = true; continue; }
    if (!separator && arg === '--temporary-proxy') { managedProxy = false; continue; }
    cleaned.push(arg);
  }
  const [name, ...args] = cleaned;
  return { name, args, managedProxy };
}
function normalizeClaudeArgs(args) { return args[0] === '--' ? args.slice(1) : args; }
function parseFlags(args, allowed = new Set()) { const out = {}; for (let i=0;i<args.length;i++) { const a=args[i]; if (!a.startsWith('--')) continue; const k=a.slice(2); if (allowed.size && !allowed.has(k)) throw new Error(`unknown flag --${k}`); out[k] = args[i+1] && !args[i+1].startsWith('--') ? args[++i] : true; } return out; }
function required(opts, key) { if (!opts[key]) throw new Error(`missing --${key}`); return opts[key]; }
