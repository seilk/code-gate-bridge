import { stripControls } from './redact.js';

export function anthropicToOpenAI(body, profile) {
  if (!body || !Array.isArray(body.messages)) throw new Error('messages must be an array');
  const messages = [];
  if (typeof body.system === 'string') messages.push({ role: 'system', content: body.system });
  for (const message of body.messages) messages.push(...convertMessage(message));
  const effort = resolveReasoningEffort(body, profile);
  return {
    model: profile.upstream.model,
    messages,
    stream: body.stream === true,
    ...(body.stream === true ? { stream_options: { include_usage: true } } : {}),
    max_tokens: Number(body.max_tokens || profile.max_output_tokens || 8192),
    ...(body.temperature === undefined ? {} : { temperature: body.temperature }),
    ...(effort === undefined ? {} : { reasoning_effort: effort }),
    ...convertTools(body),
    ...convertToolChoice(body.tool_choice)
  };
}

function resolveReasoningEffort(body, profile) {
  const requested = body?.output_config?.effort ?? body?.reasoning_effort ?? profile?.reasoning_effort;
  if (requested === undefined || requested === null || requested === '') return undefined;
  const effort = String(requested);
  const allowed = new Set(['none', 'low', 'medium', 'high', 'xhigh', 'max']);
  if (!allowed.has(effort)) return undefined;
  return effort === 'max' ? 'xhigh' : effort;
}

function convertTools(body) {
  if (!Array.isArray(body.tools) || body.tools.length === 0) return {};
  return {
    tools: body.tools.map((tool) => ({
      type: 'function',
      function: {
        name: String(tool.name || 'tool'),
        ...(tool.description ? { description: String(tool.description) } : {}),
        parameters: tool.input_schema || { type: 'object', properties: {} }
      }
    }))
  };
}

function convertToolChoice(choice) {
  if (!choice || typeof choice !== 'object') return {};
  if (choice.type === 'auto') return { tool_choice: 'auto' };
  if (choice.type === 'any') return { tool_choice: 'required' };
  if (choice.type === 'tool' && choice.name) return { tool_choice: { type: 'function', function: { name: String(choice.name) } } };
  return {};
}

function convertMessage(message) {
  if (!message || !message.role) throw new Error('message.role is required');
  const role = message.role === 'assistant' ? 'assistant' : 'user';
  if (typeof message.content === 'string') return [{ role, content: message.content }];
  if (!Array.isArray(message.content)) return [{ role, content: JSON.stringify(message.content ?? '') }];
  const toolResults = message.content.filter((b) => b?.type === 'tool_result');
  if (toolResults.length) {
    return toolResults.map((b) => ({ role: 'tool', tool_call_id: b.tool_use_id || 'toolu_unknown', content: convertToolResultContent(b.content) }));
  }
  const text = [];
  const toolCalls = [];
  for (const block of message.content) {
    if (block?.type === 'text') text.push(String(block.text || ''));
    else if (block?.type === 'tool_use') toolCalls.push({ id: block.id, type: 'function', function: { name: block.name, arguments: JSON.stringify(block.input || {}) } });
    else if (block?.type === 'image') text.push('[image omitted: profile does not support images in MVP]');
    else if (block?.text) text.push(String(block.text));
  }
  return [{ role, content: text.join('\n') || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }];
}

export function convertToolResultContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return JSON.stringify(content ?? '');
  return content.map((block) => {
    if (block?.type === 'text') return String(block.text || '');
    if (block?.type === 'image') {
      const source = block.source || {};
      if (source.type === 'base64' && source.media_type) return `[tool_result image omitted: ${stripControls(source.media_type)} base64 payload]`;
      if (source.type === 'url') return '[tool_result image omitted: url image payload]';
      return '[tool_result image omitted: unsupported image payload]';
    }
    return block?.text ? String(block.text) : JSON.stringify(block ?? '');
  }).join('\n');
}

export function openAIToAnthropic(data, profile) {
  const choice = data?.choices?.[0] || {};
  const message = choice.message || {};
  const content = [];
  if (message.content) content.push({ type: 'text', text: String(message.content) });
  if (message.tool_calls?.length) {
    for (const call of message.tool_calls) {
      let input = {};
      try { input = JSON.parse(call.function?.arguments || '{}'); } catch { input = {}; }
      content.push({ type: 'tool_use', id: call.id, name: call.function?.name || 'tool', input });
    }
  }
  return {
    id: data.id || `cgb_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model: profile.visible_model,
    content: content.length ? content : [{ type: 'text', text: '' }],
    stop_reason: choice.finish_reason === 'tool_calls' ? 'tool_use' : choice.finish_reason === 'length' ? 'max_tokens' : 'end_turn',
    usage: { input_tokens: data.usage?.prompt_tokens || 0, output_tokens: data.usage?.completion_tokens || 0 }
  };
}

export async function* openAIStreamToAnthropic(stream, profile) {
  const decoder = new TextDecoder();
  let buffer = '';
  let nextIndex = 0;
  let textIndex = null;
  const openBlocks = [];
  const toolBlocks = new Map();
  let finalFinishReason = 'stop';
  let finalUsage = null;

  yield sse('message_start', { type: 'message_start', message: { id: `cgb_${Date.now()}`, type: 'message', role: 'assistant', model: profile.visible_model, content: [], stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } } });

  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      let data;
      try { data = JSON.parse(payload); } catch { continue; }
      if (data.usage) finalUsage = data.usage;
      const choice = data.choices?.[0] || {};
      const delta = choice.delta || {};
      if (choice.finish_reason) finalFinishReason = choice.finish_reason;

      if (delta.content) {
        if (textIndex === null) {
          textIndex = nextIndex++;
          openBlocks.push(textIndex);
          yield sse('content_block_start', { type: 'content_block_start', index: textIndex, content_block: { type: 'text', text: '' } });
        }
        yield sse('content_block_delta', { type: 'content_block_delta', index: textIndex, delta: { type: 'text_delta', text: String(delta.content) } });
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const call of delta.tool_calls) {
          const key = Number.isInteger(call.index) ? call.index : toolBlocks.size;
          let block = toolBlocks.get(key);
          if (!block) {
            block = { index: nextIndex++, id: call.id || `call_${key}`, name: call.function?.name || 'tool' };
            toolBlocks.set(key, block);
            openBlocks.push(block.index);
            yield sse('content_block_start', { type: 'content_block_start', index: block.index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } });
          } else {
            if (call.id) block.id = call.id;
            if (call.function?.name) block.name = call.function.name;
          }
          const partial = call.function?.arguments;
          if (partial) yield sse('content_block_delta', { type: 'content_block_delta', index: block.index, delta: { type: 'input_json_delta', partial_json: String(partial) } });
        }
      }
    }
  }

  if (openBlocks.length === 0) {
    textIndex = nextIndex++;
    openBlocks.push(textIndex);
    yield sse('content_block_start', { type: 'content_block_start', index: textIndex, content_block: { type: 'text', text: '' } });
  }
  for (const index of openBlocks) yield sse('content_block_stop', { type: 'content_block_stop', index });
  yield sse('message_delta', { type: 'message_delta', delta: { stop_reason: finalFinishReason === 'tool_calls' ? 'tool_use' : finalFinishReason === 'length' ? 'max_tokens' : 'end_turn' }, usage: streamUsage(finalUsage) });
  yield sse('message_stop', { type: 'message_stop' });
}

function streamUsage(usage) {
  return {
    input_tokens: Number(usage?.prompt_tokens || 0),
    output_tokens: Number(usage?.completion_tokens || 0)
  };
}

function sse(event, data) { return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; }
