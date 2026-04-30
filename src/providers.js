const PROVIDERS = Object.freeze([
  Object.freeze({
    id: 'openai-compatible',
    name: 'OpenAI-compatible',
    transport: 'openai-chat-completions',
    defaultBaseUrl: undefined,
    credentialEnv: undefined,
    capabilities: Object.freeze({ streaming: true, tools: true, images: false, thinking: false })
  }),
  Object.freeze({
    id: 'letsur',
    name: 'Letsur Gateway',
    transport: 'openai-chat-completions',
    defaultBaseUrl: 'https://gw.letsur.ai/v1',
    credentialEnv: 'LETSUR_API_KEY',
    capabilities: Object.freeze({ streaming: true, tools: true, images: false, thinking: true })
  })
]);

export function listProviders() {
  return PROVIDERS.map((provider) => ({
    id: provider.id,
    name: provider.name,
    transport: provider.transport,
    defaultBaseUrl: provider.defaultBaseUrl,
    credentialEnv: provider.credentialEnv,
    capabilities: { ...provider.capabilities }
  }));
}

export function resolveProvider(id = 'openai-compatible') {
  const provider = PROVIDERS.find((candidate) => candidate.id === id);
  if (!provider) throw new Error(`unknown provider: ${id}`);
  return {
    id: provider.id,
    name: provider.name,
    transport: provider.transport,
    defaultBaseUrl: provider.defaultBaseUrl,
    credentialEnv: provider.credentialEnv,
    capabilities: { ...provider.capabilities }
  };
}
