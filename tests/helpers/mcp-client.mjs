import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const serverEntry = join(__dirname, '../../packages/remogram-mcp/bin/remogram-mcp.js');

export async function withMcpClient(cwd, fn, extraEnv = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: { ...process.env, ...extraEnv, REMOGRAM_CWD: cwd },
  });
  const client = new Client({ name: 'remogram-test', version: '0.1.0' });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

export function parseMcpPacket(result) {
  const block = result.content?.[0];
  if (!block || block.type !== 'text') {
    throw new Error('MCP result missing text content');
  }
  return JSON.parse(block.text);
}

export async function callMcpTool(cwd, name, args = {}, extraEnv = {}) {
  return withMcpClient(
    cwd,
    async (client) => {
      const result = await client.callTool({ name, arguments: args });
      return {
        isError: Boolean(result.isError),
        packet: parseMcpPacket(result),
      };
    },
    extraEnv,
  );
}
