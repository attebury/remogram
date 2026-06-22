import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './register-tools.mjs';

export async function startServer() {
  const server = new McpServer({ name: 'remogram', version: '0.1.0' });
  registerTools(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
