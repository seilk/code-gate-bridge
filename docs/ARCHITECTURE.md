# Architecture

Code Gate Bridge has five parts:

1. Profile store in `~/.config/code-gate-bridge/profiles/*.json`
2. Local Anthropic-compatible proxy bound to `127.0.0.1`
3. Adapter from Anthropic Messages to OpenAI-compatible Chat Completions
4. Claude Code launcher that generates isolated settings and runs `claude`
5. Statusline renderer that can display the observed/custom upstream

Traffic path:

```text
Claude Code -> cgb local proxy /v1/messages -> upstream /chat/completions
```

Claude Code may still see a visible model such as `claude-opus-4-7` for compatibility. The proxy sends `profile.upstream.model` to the provider.
