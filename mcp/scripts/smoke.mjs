import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/server.js"],
  cwd: process.cwd(),
  env: {
    CLOUDFLARE_ACCOUNT_ID: "smoke-test-account",
    CLOUDFLARE_API_TOKEN: "smoke-test-token",
  },
  stderr: "pipe",
});

const client = new Client({ name: "cloudflare-domain-mcp-smoke", version: "1.0.0" });

try {
  await client.connect(transport);
  const response = await client.listTools();
  const names = response.tools.map((tool) => tool.name).sort();

  assert.deepEqual(names, [
    "check_domain_availability",
    "purchase_domain",
    "quote_domain_purchase",
    "search_domains",
  ]);

  console.log(`MCP smoke test passed: ${names.join(", ")}`);
} finally {
  await client.close();
}
