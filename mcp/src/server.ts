#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CloudflareRegistrarClient } from "./cloudflare.js";
import { loadConfig } from "./config.js";
import { DomainService } from "./service.js";
import type { PurchaseQuote } from "./service.js";

const config = loadConfig();
const registrar = new CloudflareRegistrarClient(config.accountId, config.apiToken);
const domains = new DomainService(registrar);

const server = new McpServer({
  name: "cloudflare-domain-mcp",
  version: "1.0.1",
});

server.registerTool(
  "search_domains",
  {
    title: "Search Cloudflare domains",
    description:
      "Search Cloudflare Registrar for domain suggestions. Results are for discovery; use check_domain_availability for an authoritative live answer.",
    inputSchema: {
      query: z.string().min(1).describe("Brand, phrase, or partial domain name"),
      limit: z.number().int().min(1).max(20).default(10),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ query, limit }) => toolResult(() => domains.search(query, limit)),
);

server.registerTool(
  "check_domain_availability",
  {
    title: "Check domain availability",
    description:
      "Authoritatively check a specific domain's current availability and registration/renewal pricing through Cloudflare Registrar. Use when the user asks whether a domain is available. This never purchases or reserves a domain.",
    inputSchema: {
      domain: z.string().describe("Exact registrable domain, such as example.xyz"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ domain }) => toolResult(() => domains.checkAvailability(domain)),
);

server.registerTool(
  "quote_domain_purchase",
  {
    title: "Quote a domain purchase",
    description:
      "Create a five-minute, single-use purchase quote after checking live Cloudflare availability, the registry's minimum term, and the hard $20 total initial-charge limit. This does not purchase the domain.",
    inputSchema: {
      domain: z.string().describe("Exact registrable domain to quote"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ domain }) => toolResult(() => domains.createQuote(domain)),
);

server.registerTool(
  "purchase_domain",
  {
    title: "Purchase a Cloudflare domain",
    description:
      "BILLABLE AND NON-REFUNDABLE. Purchase exactly one domain using a fresh quote. The caller must pass the exact visible domain, USD total, and quote ID. After rechecking availability and pricing, the server opens a protocol-level MCP elicitation that requires the user to explicitly approve the exact purchase. It enforces a hard $20 total limit and disables auto-renewal.",
    inputSchema: {
      quote_id: z.string().uuid().describe("Quote ID returned by quote_domain_purchase"),
      domain: z.string().describe("Exact domain shown to and approved by the user"),
      currency: z.literal("USD").describe("Approved quote currency"),
      total_cents: z
        .number()
        .int()
        .min(0)
        .max(2_000)
        .describe("Exact approved total initial charge in US cents"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ quote_id, domain, currency, total_cents }) =>
    toolResult(() =>
      domains.purchase(
        {
          quoteId: quote_id,
          domain,
          currency,
          totalCents: total_cents,
        },
        requestPurchaseApproval,
      ),
    ),
);

async function requestPurchaseApproval(quote: PurchaseQuote): Promise<boolean> {
  const capabilities = server.server.getClientCapabilities();
  if (!capabilities?.elicitation) {
    throw new Error(
      "This MCP client does not support elicitation, so the purchase is blocked. Use a client with MCP elicitation support.",
    );
  }

  const response = await server.server.elicitInput({
    mode: "form",
    message:
      `Approve the billable, non-refundable purchase of ${quote.domain} for ` +
      `$${quote.totalCost} USD (${quote.years} year${quote.years === 1 ? "" : "s"})? ` +
      "Auto-renewal will be disabled.",
    requestedSchema: {
      type: "object",
      properties: {
        confirmPurchase: {
          type: "boolean",
          title: "Approve this domain purchase",
          description: `Purchase ${quote.domain} now for exactly $${quote.totalCost} USD`,
          default: false,
        },
      },
      required: ["confirmPurchase"],
    },
  });

  return (
    response.action === "accept" && response.content?.confirmPurchase === true
  );
}

async function toolResult<T>(operation: () => Promise<T>) {
  try {
    const result = await operation();
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return {
      isError: true,
      content: [{ type: "text" as const, text: message }],
    };
  }
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("cloudflare-domain-mcp running over stdio");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown startup error";
  console.error(`cloudflare-domain-mcp failed: ${message}`);
  process.exit(1);
});
