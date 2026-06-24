#!/usr/bin/env node
// Bulk MCP client for Tars. Connects to the running loopback server and runs a
// batch of tool calls over a single session. Input: JSON array of
//   { tool: string, args?: object, ref?: string }
// from argv[2] (a file path) or stdin. After a memory_remember, the created
// entityId is stored under `ref`; later items can reference it anywhere with the
// string "$ref:<name>" (deep-substituted before the call). Prints a JSON array of
// per-call results to stdout. Not part of the shipped product — an import helper.
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = process.env.TARS_URL || 'http://127.0.0.1:8787/mcp';
const file = process.argv[2];
const raw = file ? readFileSync(file, 'utf8') : readFileSync(0, 'utf8');
const batch = JSON.parse(raw);

function deepResolve(value, refs) {
  if (typeof value === 'string') {
    if (value.startsWith('$ref:')) {
      const key = value.slice(5);
      if (!(key in refs)) throw new Error(`Unresolved ref: ${key}`);
      return refs[key];
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => deepResolve(v, refs));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepResolve(v, refs);
    return out;
  }
  return value;
}

const client = new Client({ name: 'tars-bulk-writer', version: '1.0.0' }, { capabilities: {} });
const transport = new StreamableHTTPClientTransport(new URL(url));
await client.connect(transport);

const refs = {};
const results = [];
for (let i = 0; i < batch.length; i++) {
  const item = batch[i];
  const { tool, ref } = item;
  let args;
  try {
    args = deepResolve(item.args ?? {}, refs);
  } catch (e) {
    results.push({ i, ref, tool, ok: false, error: String(e?.message || e) });
    continue;
  }
  try {
    const res = await client.callTool({ name: tool, arguments: args });
    const text = (res.content || []).map((c) => (c.type === 'text' ? c.text : '')).join('');
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    if (ref && parsed && parsed.entityId) refs[ref] = parsed.entityId;
    results.push({ i, ref, tool, ok: !res.isError, parsed: parsed ?? undefined, text: parsed ? undefined : text });
  } catch (e) {
    results.push({ i, ref, tool, ok: false, error: String(e?.message || e) });
  }
}

await client.close();
process.stdout.write(JSON.stringify(results, null, 2));
