import fs from 'node:fs/promises';
import { readProfile, resolveApiKey } from './config.js';
import { listenProxy } from './proxy.js';

export async function doctor(profileName, env = process.env) {
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok, detail });
  try {
    const profile = await readProfile(profileName, env); add('profile', true, profile.name);
    try { await resolveApiKey(profile, env); add('api_key', true, profile.upstream.api_key_env || 'inline'); } catch (e) { add('api_key', false, e.message); }
    if (profile.upstream.base_url.includes('127.0.0.1') || profile.upstream.base_url.includes('localhost')) add('upstream_not_local_proxy', false, 'upstream base_url should be provider URL, not cgb local proxy');
    else add('upstream_not_local_proxy', true, profile.upstream.base_url);
  } catch (e) { add('profile', false, e.message); }
  try { await fs.access(process.cwd()); add('cwd', true, process.cwd()); } catch (e) { add('cwd', false, e.message); }
  return checks;
}

export async function routeTest(profileName, prompt = 'Reply exactly CGB_ROUTE_OK', env = process.env) {
  const profile = await readProfile(profileName, env);
  const proxy = await listenProxy(profile, { env });
  try {
    const response = await fetch(`${proxy.url}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': proxy.token },
      body: JSON.stringify({ model: profile.visible_model, max_tokens: 32, messages: [{ role: 'user', content: prompt }] })
    });
    const data = await response.json();
    return { ok: response.ok, proxy_url: proxy.url, visible_model: profile.visible_model, upstream_model: profile.upstream.model, response: data };
  } finally { proxy.server.close(); }
}
