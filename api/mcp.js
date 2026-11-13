// /api/mcp (also served at /mcp) — public, read-only MCP server for Exit 163.
// Streamable HTTP transport, stateless: every POST is one JSON-RPC message (or batch)
// answered with plain JSON. Add it to an MCP client as: https://www.exit163.com/mcp
const { readBody } = require('../lib/http');
const { TOOL_DEFS } = require('../lib/tools');

const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'exit163', title: 'Exit 163: Bergen County, NJ', version: '0.1.0', websiteUrl: 'https://www.exit163.com' };
const INSTRUCTIONS = 'Exit 163 is a local guide to Bergen County, New Jersey: verified events and things to do, by town, with sources. ' +
  'Use search_events for "what should I do this weekend in <town>" questions. Results are never paid placements. ' +
  'Free weekly newsletter: https://www.exit163.com';

const PUBLIC_TOOLS = TOOL_DEFS.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: t.input_schema,
  annotations: { readOnlyHint: true, openWorldHint: false },
}));

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
}

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function handle(msg) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(msg?.id, -32600, 'Invalid request');
  const isNotification = msg.id === undefined;
  const p = msg.params || {};

  switch (msg.method) {
    case 'initialize':
      return ok(msg.id, {
        protocolVersion: SUPPORTED.includes(p.protocolVersion) ? p.protocolVersion : SUPPORTED[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    case 'ping':
      return ok(msg.id, {});
    case 'tools/list':
      return ok(msg.id, { tools: PUBLIC_TOOLS });
    case 'tools/call': {
      const tool = TOOL_DEFS.find((t) => t.name === p.name);
      if (!tool) return fail(msg.id, -32602, `Unknown tool: ${p.name}`);
      try {
        const out = await tool.run(p.arguments || {}, { channel: 'mcp' });
        return ok(msg.id, { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], structuredContent: out, isError: Boolean(out?.error) });
      } catch (e) {
        console.error('mcp tool error', e);
        return ok(msg.id, { content: [{ type: 'text', text: `Tool failed: ${e.message}` }], isError: true });
      }
    }
    default:
      if (isNotification || msg.method.startsWith('notifications/')) return null;
      return fail(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') {
    // No server-initiated stream. Browsers get a pointer instead of a bare 405.
    if ((req.headers.accept || '').includes('text/event-stream')) return res.status(405).send('Stateless server: no SSE stream');
    return res.status(200).json({ ...SERVER_INFO, mcp: 'https://www.exit163.com/mcp', transport: 'streamable-http', tools: PUBLIC_TOOLS.map((t) => t.name) });
  }
  if (req.method === 'DELETE') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  const body = await readBody(req);
  const batch = Array.isArray(body);
  const replies = (await Promise.all((batch ? body : [body]).map(handle))).filter(Boolean);
  if (!replies.length) return res.status(202).end();
  return res.status(200).json(batch ? replies : replies[0]);
};
