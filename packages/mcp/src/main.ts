import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildTools, createMcpServer } from "./tools.js";

// stdout carries the MCP protocol, so anything we say goes to stderr.
const token = process.env.COPILOT_API_TOKEN;
const server = createMcpServer(
  buildTools({
    baseUrl: process.env.COPILOT_URL || "http://localhost:8787",
    ...(token ? { token } : {}),
  }),
);
await server.connect(new StdioServerTransport());
console.error("lifecycle-copilot MCP server ready on stdio");
