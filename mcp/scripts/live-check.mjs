import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";

const domain = process.argv[2];
if (!domain) {
  console.error("Usage: npm run live-check -- example.xyz");
  process.exit(2);
}

if (!process.env.CLOUDFLARE_ACCOUNT_ID) {
  console.error("CLOUDFLARE_ACCOUNT_ID is required.");
  process.exit(2);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/server.js"],
  cwd: process.cwd(),
  env: {
    ...getDefaultEnvironment(),
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    ...(process.env.CLOUDFLARE_API_TOKEN
      ? { CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN }
      : {}),
    ...(process.env.CLOUDFLARE_KEYCHAIN_SERVICE
      ? { CLOUDFLARE_KEYCHAIN_SERVICE: process.env.CLOUDFLARE_KEYCHAIN_SERVICE }
      : {}),
    ...(process.env.CLOUDFLARE_KEYCHAIN_ACCOUNT
      ? { CLOUDFLARE_KEYCHAIN_ACCOUNT: process.env.CLOUDFLARE_KEYCHAIN_ACCOUNT }
      : {}),
  },
  stderr: "pipe",
});

const client = new Client({ name: "cloudflare-domain-live-check", version: "1.0.0" });

try {
  await client.connect(transport);
  const result = await client.callTool({
    name: "check_domain_availability",
    arguments: { domain },
  });

  const text = result.content.find((item) => item.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("The MCP tool returned no text response.");
  }

  if (result.isError) {
    throw new Error(text.text);
  }

  console.log(text.text);
} finally {
  await client.close();
}
