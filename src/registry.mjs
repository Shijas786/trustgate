// Thin client for Concordium's hosted Agent Registry MCP server (stateless, holds no keys).
const MCP = process.env.REGISTRY_MCP_URL || 'https://agent-registry-mcp.concordium.com/mcp';
export const NETWORK = process.env.CCD_NETWORK || 'testnet';
let seq = 0;
export async function registry(tool, args = {}) {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method: 'tools/call', params: { name: tool, arguments: { network: NETWORK, ...args } } }),
  });
  const text = await res.text();
  const line = text.startsWith('{') ? text : text.split('\n').find((l) => l.startsWith('data:'))?.slice(5);
  const msg = JSON.parse(line);
  if (msg.error) throw new Error(`${tool}: ${msg.error.message}`);
  const raw = msg.result.content?.[0]?.text ?? '';
  if (msg.result.isError) throw new Error(`${tool}: ${raw}`);
  return msg.result.structuredContent ?? JSON.parse(raw);
}
