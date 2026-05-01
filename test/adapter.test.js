import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { anthropicToOpenAI, openAIToAnthropic, openAIStreamToAnthropic, convertToolResultContent } from '../src/adapter.js';

const profile = { visible_model: 'claude-opus-4-7', max_output_tokens: 64, upstream: { model: 'gpt-4.1' } };

test('rewrites visible Claude model to upstream model', () => {
  const out = anthropicToOpenAI({ model: 'claude-opus-4-7', messages: [{ role: 'user', content: 'hi' }] }, profile);
  assert.equal(out.model, 'gpt-4.1');
  assert.deepEqual(out.messages, [{ role: 'user', content: 'hi' }]);
});

test('requests streaming usage from OpenAI-compatible upstreams', () => {
  const out = anthropicToOpenAI({ model: 'claude-opus-4-7', messages: [{ role: 'user', content: 'hi' }], stream: true }, profile);
  assert.equal(out.stream, true);
  assert.deepEqual(out.stream_options, { include_usage: true });
});

test('uses profile reasoning_effort as OpenAI-compatible default', () => {
  const out = anthropicToOpenAI({ model: 'claude-opus-4-7', messages: [{ role: 'user', content: 'hi' }] }, { ...profile, reasoning_effort: 'xhigh' });
  assert.equal(out.reasoning_effort, 'xhigh');
});

test('maps Claude Code /effort output_config to reasoning_effort and overrides profile default', () => {
  const out = anthropicToOpenAI({
    model: 'claude-opus-4-7',
    messages: [{ role: 'user', content: 'hi' }],
    output_config: { effort: 'high' }
  }, { ...profile, reasoning_effort: 'low' });
  assert.equal(out.reasoning_effort, 'high');
  assert.equal(out.output_config, undefined);
});

test('maps Claude Code /effort max to xhigh for OpenAI-compatible reasoning_effort', () => {
  const out = anthropicToOpenAI({
    model: 'claude-opus-4-7',
    messages: [{ role: 'user', content: 'hi' }],
    output_config: { effort: 'max' }
  }, profile);
  assert.equal(out.reasoning_effort, 'xhigh');
});

test('preserves direct request reasoning_effort when Claude Code sends it', () => {
  const out = anthropicToOpenAI({ model: 'claude-opus-4-7', messages: [{ role: 'user', content: 'hi' }], reasoning_effort: 'medium' }, { ...profile, reasoning_effort: 'low' });
  assert.equal(out.reasoning_effort, 'medium');
});

test('forwards Claude Code tool definitions to OpenAI-compatible upstream', () => {
  const out = anthropicToOpenAI({
    model: 'claude-opus-4-7',
    messages: [{ role: 'user', content: 'edit the file' }],
    tools: [
      {
        name: 'Read',
        description: 'Read a file from disk',
        input_schema: {
          type: 'object',
          properties: { file_path: { type: 'string' } },
          required: ['file_path']
        }
      },
      {
        name: 'Bash',
        description: 'Run a shell command',
        input_schema: {
          type: 'object',
          properties: { command: { type: 'string' } },
          required: ['command']
        }
      }
    ],
    tool_choice: { type: 'auto' }
  }, profile);

  assert.equal(out.tool_choice, 'auto');
  assert.deepEqual(out.tools, [
    {
      type: 'function',
      function: {
        name: 'Read',
        description: 'Read a file from disk',
        parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'Bash',
        description: 'Run a shell command',
        parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] }
      }
    }
  ]);
});

test('maps Anthropic forced tool_choice to OpenAI-compatible function choice', () => {
  const out = anthropicToOpenAI({
    model: 'claude-opus-4-7',
    messages: [{ role: 'user', content: 'read' }],
    tools: [{ name: 'Read', input_schema: { type: 'object', properties: {} } }],
    tool_choice: { type: 'tool', name: 'Read' }
  }, profile);
  assert.deepEqual(out.tool_choice, { type: 'function', function: { name: 'Read' } });
});

test('redacts tool_result image URLs', () => {
  const text = convertToolResultContent([{ type: 'text', text: 'saw' }, { type: 'image', source: { type: 'url', url: 'https://secret.example/signed?token=***' } }]);
  assert.equal(text, 'saw\n[tool_result image omitted: url image payload]');
  assert(!text.includes('secret.example'));
  assert(!text.includes('token'));
});

test('maps OpenAI response to visible Claude model', () => {
  const out = openAIToAnthropic({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 2 } }, profile);
  assert.equal(out.model, 'claude-opus-4-7');
  assert.equal(out.content[0].text, 'OK');
});

test('maps non-stream OpenAI tool_calls to Anthropic tool_use blocks', () => {
  const out = openAIToAnthropic({
    choices: [{
      message: { tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'Read', arguments: '{"file_path":"README.md"}' } }] },
      finish_reason: 'tool_calls'
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5 }
  }, profile);
  assert.equal(out.stop_reason, 'tool_use');
  assert.deepEqual(out.content, [{ type: 'tool_use', id: 'call_1', name: 'Read', input: { file_path: 'README.md' } }]);
});

test('maps streamed OpenAI tool_calls to Anthropic tool_use SSE events', async () => {
  const stream = Readable.from([
    Buffer.from('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"Bash","arguments":"{\\"command\\":"}}]}}]}\n\n'),
    Buffer.from('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"pwd\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n'),
    Buffer.from('data: [DONE]\n\n')
  ]);
  const events = [];
  for await (const event of openAIStreamToAnthropic(stream, profile)) events.push(event);
  const joined = events.join('');
  assert.match(joined, /event: content_block_start\ndata: \{"type":"content_block_start","index":0,"content_block":\{"type":"tool_use","id":"call_1","name":"Bash","input":\{\}\}\}/);
  assert.match(joined, /"type":"input_json_delta","partial_json":"\{\\\"command\\\":"/);
  assert.match(joined, /"type":"input_json_delta","partial_json":"\\\"pwd\\\"\}"/);
  assert.match(joined, /"stop_reason":"tool_use"/);
});

test('propagates final streaming usage so Claude Code can update context_window', async () => {
  const stream = Readable.from([
    Buffer.from('data: {"choices":[{"delta":{"content":"OK"}}]}\n\n'),
    Buffer.from('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'),
    Buffer.from('data: {"choices":[],"usage":{"prompt_tokens":1234,"completion_tokens":56,"total_tokens":1290}}\n\n'),
    Buffer.from('data: [DONE]\n\n')
  ]);
  const events = [];
  for await (const event of openAIStreamToAnthropic(stream, profile)) events.push(event);
  const joined = events.join('');
  assert.match(joined, /event: message_delta\ndata: .*"usage":\{"input_tokens":1234,"output_tokens":56\}/);
});
