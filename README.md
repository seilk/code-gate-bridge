# Claude Provider Kit

A local Anthropic-compatible proxy and profile manager for Claude Code. It helps you use custom upstream models while keeping Claude Code configuration reversible, observable, and safe.

## Status

MVP. The first target is OpenAI-compatible `/v1/chat/completions` upstreams.

## Prerequisites

- Node.js 20+
- npm
- Claude Code CLI available as `claude`
- An OpenAI-compatible provider endpoint and API key

## Quick start

```bash
git clone https://github.com/seilk/claude-provider-kit.git
cd claude-provider-kit
npm install -g .

cpk init
# Put LETSUR_API_KEY=... in ~/.config/claude-provider-kit/secrets.env
cpk profile create letsur \
  --provider letsur \
  --model gpt-5.5 \
  --visible-model claude-opus-4-7

cpk doctor letsur
cpk route-test letsur --prompt 'Reply exactly CPK_ROUTE_OK'
cpk run letsur -- -p 'Reply exactly OK' --max-turns 1
```

`letsur` is only an example profile name. Any provider exposing OpenAI-compatible `/v1/chat/completions` can be used by changing `--base-url`, `--model`, and `--key-env`.

## What this changes on your machine

Creates local user files only:

```text
~/.config/claude-provider-kit/secrets.env
~/.config/claude-provider-kit/profiles/*.json
~/.local/state/claude-provider-kit/state.json
~/.local/state/claude-provider-kit/events.jsonl
```

`cpk run` creates a temporary Claude Code settings file for that process and points Claude Code at a local proxy. It does not require putting provider API keys in `~/.claude/settings.json`.

## Commands

```text
cpk init                    Create config and secrets file
cpk providers               List built-in provider presets
cpk profile create          Create a provider profile
cpk profile list            List profiles
cpk profile show            Show a profile with inline secrets redacted
cpk serve                   Start a local proxy for manual integration
cpk run                     Launch Claude Code through a profile
cpk doctor                  Validate profile/config basics
cpk route-test              Send a real request through the local proxy
cpk status                  Show last observed proxy state
```

`cpk serve` hides the local bearer token by default. Use `--show-token` only for manual debugging.

## Supported MVP API subset

- `POST /v1/messages`
- `GET /v1/models`
- `HEAD /v1/messages` / `OPTIONS /v1/messages` compatibility probes
- text input/output
- non-streaming text
- basic streaming text, tested only for text deltas
- URL images in `tool_result` are redacted to placeholders

Not yet stable:

- image forwarding
- prompt caching
- extended thinking
- server tools
- fallback chains
- complete streaming tool-call deltas
- web dashboard

Unsupported features should fail loudly as the project matures. Current MVP is intentionally narrow.

## Security model

- Proxy binds to `127.0.0.1` by default.
- Local proxy requests require a bearer token.
- Local token uses cryptographic randomness.
- Upstream API keys live in `secrets.env` or process env, not in repo files.
- Logs are metadata-only and redacted.
- `profile show` redacts inline API keys.

## Troubleshooting

### Claude Code still seems to use the wrong provider

Run:

```bash
cpk route-test <profile>
cpk status
```

The `upstream_model` in state/logs is the real provider model. Claude Code may still display the visible compatibility model.

### API key missing

Set the env var named by `--key-env` in either your shell or:

```text
~/.config/claude-provider-kit/secrets.env
```

### Statusline is blank or stale

If you wrap an existing statusline, set:

```bash
CPK_BASE_STATUSLINE_COMMAND='<your original statusline command>'
```

`cpk run` passes this through to its generated settings.

## Development

```bash
npm test
npm run lint
```
