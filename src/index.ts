#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  if (!process.env.SVARA_API_KEY) {
    // stderr only: stdout is reserved for the MCP protocol.
    console.error("svara-mcp: SVARA_API_KEY is not set. Create an API key at https://svarapi.io/dashboard.");
  }
}

main().catch((err) => {
  console.error("svara-mcp failed to start:", err);
  process.exit(1);
});
