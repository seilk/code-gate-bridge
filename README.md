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
  --format yaml \
  --visible-model claude-opus-4-7

cpk doctor letsur
cpk route-test letsur --prompt 'Reply exactly CPK_ROUTE_OK'
cpk run letsur -p 'Reply exactly OK' --max-turns 1
cpk letsur --bare
```

`letsur` is only an example profile name. Any provider exposing OpenAI-compatible `/v1/chat/completions` can be used by changing `--base-url`, `--model`, and `--key-env`.

For multiple models on the same provider, create separate profiles named from the provider-recognized upstream model string:

```bash
cpk profile create letsur-gpt-5.5 --provider letsur --model gpt-5.5 --format yaml
cpk profile create letsur-gemini-3-flash-preview --provider letsur --model gemini-3-flash-preview --format yaml

cpk letsur-gpt-5.5 --bare
cpk letsur-gemini-3-flash-preview --bare
```

The direct `cpk <profile>` form is native CPK behavior, not a shell alias. Claude Code flags are forwarded as-is, so `cpk letsur-gpt-5.5 --bare -p "hi"` works without the `--` separator. Prefer profile names in the form `<provider>-<upstream-model>`, preserving provider-recognized model names such as `gpt-5.5` or `gemini-3-flash-preview` for consistency.

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
cpk profile export          Export a profile as JSON or YAML
cpk profile import          Import a profile from JSON or YAML
cpk serve                   Start a local proxy for manual integration
cpk run                     Launch Claude Code through a profile
cpk <profile>               Launch a profile directly, forwarding Claude Code flags
cpk doctor                  Validate profile/config basics
cpk route-test              Send a real request through the local proxy
cpk status                  Show last observed proxy state
```

`cpk serve` hides the local bearer token by default. Use `--show-token` only for manual debugging.

## Managing profiles as JSON or YAML

Profiles are plain files under:

```text
~/.config/claude-provider-kit/profiles/
```

CPK reads either `.json`, `.yaml`, or `.yml` profiles. JSON is the default, but YAML is often nicer for hand-editing:

```bash
cpk profile create letsur --provider letsur --model gpt-5.5 --format yaml
cpk profile show letsur --format yaml
cpk profile export letsur --format yaml --output letsur.yaml
cpk profile import letsur.yaml --name letsur-copy --format json
```

Example YAML profile:

```yaml
name: letsur
provider: letsur
visible_model: claude-opus-4-7
client_model: opus
context_window: 1000000
max_output_tokens: 8192
upstream:
  type: openai-chat-completions
  base_url: https://gw.letsur.ai/v1
  model: gpt-5.5
  api_key_env: LETSUR_API_KEY
capabilities:
  streaming: true
  tools: true
  images: false
  thinking: true
  prompt_cache: false
retry:
  max_retries: 0
  base_delay_ms: 250
```

The built-in YAML reader intentionally supports a small safe subset: nested mappings and scalar strings/numbers/booleans/null. It rejects arrays, anchors, aliases, and flow-style YAML instead of guessing. Secrets should still live in `secrets.env`; `profile show` and `profile export` redact inline `api_key` values.

`visible_model` is the model ID CPK returns in Anthropic-compatible responses. `client_model` is the Claude Code selector passed to the Claude Code CLI, normally `opus`, so Claude Code accepts the launch while CPK routes to the real upstream model.

## Claude Code display behavior

Claude Code owns the top welcome-box model/billing text. CPK does not try to rewrite that header. CPK's source of truth is the status line, which shows the real route, for example `CPK letsur-gpt-5.5 → gpt-5.5 as claude-opus-4-7`.

`cpk run` passes only `ANTHROPIC_AUTH_TOKEN` for the local proxy token, not `ANTHROPIC_API_KEY`, to avoid Claude Code's custom API-key confirmation prompt.

To verify the interactive TUI path with tmux:

```bash
npm run test:tui -- letsur-gpt-5.5
```

This launches a real Claude Code TUI in a temporary tmux session, checks that the CPK route statusline appears, sends a prompt, verifies the expected reply, writes the final capture to `/tmp`, and closes the tmux session.

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
