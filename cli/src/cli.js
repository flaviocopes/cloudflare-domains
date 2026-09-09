#!/usr/bin/env node

import { Command, InvalidArgumentError } from "commander";
import prompts from "prompts";
import { CloudflareApiError, CloudflareClient } from "./cloudflare.js";
import { deleteToken, getToken, saveToken } from "./keychain.js";

const program = new Command();

program
  .name("cf-domains")
  .description("View Cloudflare zones and manage their DNS records from the command line.")
  .version("1.0.1")
  .addHelpText(
    "after",
    `

Agent-safe workflow:
  1. Run "cf-domains auth status" before any Cloudflare DNS work.
  2. Never ask for, print, or log the API token. On macOS, store it in Keychain.
  3. Run "cf-domains records <domain>" before changing DNS records.
  4. Prefer updating existing records over creating duplicates.
  5. Delete records only when explicitly requested.

Examples:
  cf-domains auth status
  cf-domains zones
  cf-domains records example.com
  cf-domains add example.com --type A --name www --content 203.0.113.10 --proxied
`,
  );

const auth = program.command("auth").description("Manage Cloudflare API authentication.");

auth
  .command("login")
  .description("Store a Cloudflare API token in macOS Keychain.")
  .action(async () => {
    const response = await prompts({
      type: "password",
      name: "token",
      message: "Cloudflare API token",
      validate: (value) => (value.trim() ? true : "Token is required"),
    });

    if (!response.token) {
      console.log("Login cancelled.");
      return;
    }

    const token = response.token.trim();
    const client = new CloudflareClient(token);
    await client.verifyToken();
    await saveToken(token);

    console.log("Cloudflare API token saved to macOS Keychain.");
  });

auth
  .command("status")
  .description("Check whether a Cloudflare API token is configured and valid.")
  .action(async () => {
    const token = await getToken();
    if (!token) {
      console.log("No Cloudflare API token is saved. Run `cf-domains auth login`.");
      return;
    }

    const client = new CloudflareClient(token);
    const response = await client.verifyToken();
    const status = response.result?.status ?? "active";

    console.log(`Cloudflare API token is configured and ${status}.`);
  });

auth
  .command("logout")
  .description("Remove the saved Cloudflare API token from macOS Keychain.")
  .action(async () => {
    const deleted = await deleteToken();
    console.log(deleted ? "Cloudflare API token removed." : "No saved token found.");
  });

program
  .command("zones")
  .description("List accessible Cloudflare zones.")
  .action(async () => {
    const client = await getClient();
    const zones = await client.listZones();

    printTable(
      zones.map((zone) => ({
        id: zone.id,
        name: zone.name,
        status: zone.status,
      })),
    );
  });

program
  .command("records")
  .argument("<domain>", "Cloudflare zone domain, for example example.com")
  .description("List DNS records for a domain.")
  .addHelpText(
    "after",
    `

Agent note:
  Use this command before add, update, or delete so you can avoid duplicate
  records and identify the correct record ID.

Examples:
  cf-domains records example.com
`,
  )
  .action(async (domain) => {
    const client = await getClient();
    const { records } = await client.listRecords(domain);

    printRecords(records);
  });

program
  .command("add")
  .argument("<domain>", "Cloudflare zone domain, for example example.com")
  .requiredOption("--type <type>", "DNS record type, for example A, CNAME, TXT")
  .requiredOption("--name <name>", "DNS record name, for example @ or www")
  .requiredOption("--content <content>", "DNS record value")
  .option("--ttl <seconds>", "TTL in seconds, or 1 for automatic", parseTtl, 1)
  .option("--proxied", "Proxy eligible records through Cloudflare")
  .option("--comment <comment>", "Optional record comment")
  .description("Create a DNS record.")
  .addHelpText(
    "after",
    `

Agent note:
  Run "cf-domains records <domain>" first and create a new record only when
  an equivalent record does not already exist.

Examples:
  cf-domains add example.com --type A --name www --content 203.0.113.10 --proxied
  cf-domains add example.com --type TXT --name @ --content "hello world"
`,
  )
  .action(async (domain, options) => {
    const client = await getClient();
    const { record } = await client.createRecord(domain, {
      type: options.type.toUpperCase(),
      name: options.name,
      content: options.content,
      ttl: options.ttl,
      proxied: Boolean(options.proxied),
      comment: options.comment,
    });

    console.log("DNS record created:");
    printRecords([record]);
  });

program
  .command("update")
  .argument("<domain>", "Cloudflare zone domain, for example example.com")
  .argument("<record-id>", "Cloudflare DNS record ID")
  .option("--type <type>", "DNS record type, for example A, CNAME, TXT")
  .option("--name <name>", "DNS record name, for example @ or www")
  .option("--content <content>", "DNS record value")
  .option("--ttl <seconds>", "TTL in seconds, or 1 for automatic", parseTtl)
  .option("--proxied", "Proxy eligible records through Cloudflare")
  .option("--dns-only", "Disable Cloudflare proxying")
  .option("--comment <comment>", "Record comment")
  .description("Update a DNS record.")
  .addHelpText(
    "after",
    `

Agent note:
  Get the record ID with "cf-domains records <domain>" and update only the
  requested fields. Use "--dns-only" to set proxied=false.

Examples:
  cf-domains update example.com <record-id> --content 203.0.113.11
  cf-domains update example.com <record-id> --dns-only
`,
  )
  .action(async (domain, recordId, options) => {
    if (options.proxied && options.dnsOnly) {
      throw new Error("Use either `--proxied` or `--dns-only`, not both.");
    }

    const updates = collectRecordUpdates(options);
    if (Object.keys(updates).length === 0) {
      throw new Error("Provide at least one field to update.");
    }

    const client = await getClient();
    const { record } = await client.updateRecord(domain, recordId, updates);

    console.log("DNS record updated:");
    printRecords([record]);
  });

program
  .command("delete")
  .argument("<domain>", "Cloudflare zone domain, for example example.com")
  .argument("<record-id>", "Cloudflare DNS record ID")
  .option("-y, --yes", "Delete without confirmation")
  .description("Delete a DNS record.")
  .addHelpText(
    "after",
    `

Agent note:
  Delete records only when the user explicitly asks for deletion. Without
  "--yes", the command asks for confirmation.

Examples:
  cf-domains delete example.com <record-id>
  cf-domains delete example.com <record-id> --yes
`,
  )
  .action(async (domain, recordId, options) => {
    if (!options.yes) {
      const response = await prompts({
        type: "confirm",
        name: "confirmed",
        message: `Delete DNS record ${recordId} from ${domain}?`,
        initial: false,
      });

      if (!response.confirmed) {
        console.log("Delete cancelled.");
        return;
      }
    }

    const client = await getClient();
    await client.deleteRecord(domain, recordId);

    console.log(`DNS record ${recordId} deleted from ${domain}.`);
  });

program.parseAsync(process.argv).catch((error) => {
  if (error instanceof CloudflareApiError) {
    console.error(`Cloudflare API error: ${error.message}`);
  } else {
    console.error(error.message);
  }

  process.exitCode = 1;
});

async function getClient() {
  const token = await getToken();
  return new CloudflareClient(token);
}

function collectRecordUpdates(options) {
  const updates = {};

  if (options.type !== undefined) {
    updates.type = options.type.toUpperCase();
  }

  for (const key of ["name", "content", "ttl", "comment"]) {
    if (options[key] !== undefined) {
      updates[key] = options[key];
    }
  }

  if (options.proxied) {
    updates.proxied = true;
  }

  if (options.dnsOnly) {
    updates.proxied = false;
  }

  return updates;
}

function parseTtl(value) {
  const ttl = Number.parseInt(value, 10);
  if (!Number.isInteger(ttl) || ttl < 1) {
    throw new InvalidArgumentError("TTL must be a positive integer.");
  }

  return ttl;
}

function printRecords(records) {
  printTable(
    records.map((record) => ({
      id: record.id,
      type: record.type,
      name: record.name,
      content: record.content,
      ttl: record.ttl,
      proxied: record.proxied ? "yes" : "no",
      comment: record.comment ?? "",
    })),
  );
}

function printTable(rows) {
  if (rows.length === 0) {
    console.log("No results.");
    return;
  }

  const columns = Object.keys(rows[0]);
  const widths = Object.fromEntries(
    columns.map((column) => [
      column,
      Math.max(column.length, ...rows.map((row) => String(row[column] ?? "").length)),
    ]),
  );

  const header = columns.map((column) => column.padEnd(widths[column])).join("  ");
  const separator = columns.map((column) => "-".repeat(widths[column])).join("  ");
  const body = rows.map((row) =>
    columns.map((column) => String(row[column] ?? "").padEnd(widths[column])).join("  "),
  );

  console.log([header, separator, ...body].join("\n"));
}
