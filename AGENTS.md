# Agent guide

This toolkit can make billable registrations and destructive DNS changes.

The code sits at the repository root: `mcp/` is the Registrar MCP server and
`cli/` is the `cf-domains` DNS CLI. All project documentation lives in
`README.md`. Read its [Security](README.md#security),
[Architecture](README.md#architecture), and
[Technical decisions](README.md#technical-decisions) sections before editing
source.

## Commands

Registrar MCP:

```bash
cd mcp
npm install
npm run check
npm test
npm run smoke
```

Use `npm run live-check -- domain.dev` only with explicitly configured,
read-only intent. Never make a real registration from a test.

DNS CLI:

```bash
cd cli
npm install
npm run check
npm test
```

## Shared invariants

- Never commit, print, or log a Cloudflare API token.
- Never add real account IDs, usernames, emails, or home paths to examples.
- Keep Registrar and DNS tokens separate and least-privileged.
- Keep network requests limited to Cloudflare API v4.
- Keep `node_modules`, build output, environment files, and logs out of the repository.

## Registrar invariants

- Keep searches, checks, and quotes read-only.
- Keep the $20 complete-initial-charge limit in executable code.
- Use integer cents for prices.
- Reject premium and non-USD purchases.
- Keep quotes short-lived, exact-match, and single-use.
- Recheck availability, price, and term immediately before approval.
- Require explicit MCP form elicitation before registration.
- Block purchases when elicitation is unavailable or rejected.
- Keep auto-renewal disabled.
- Never retry an ambiguous registration automatically.

## DNS invariants

- Find the exact zone before record operations.
- Normalize relative record names against that zone.
- Allow-list fields sent to Cloudflare.
- Update only explicitly provided fields.
- Require negative-default confirmation before deletion.
- Keep `--yes` explicit and documented as an automation escape hatch.

## Source boundaries

The MCP package separates protocol (`mcp/src/server.ts`), policy
(`mcp/src/service.ts`), HTTP (`mcp/src/cloudflare.ts`), secret loading
(`mcp/src/config.ts`), domain validation (`mcp/src/domain.ts`), and money math
(`mcp/src/money.ts`).

The CLI separates command interaction (`cli/src/cli.js`), Cloudflare HTTP and
record normalization (`cli/src/cloudflare.js`), and secret loading
(`cli/src/keychain.js`).

Preserve these boundaries and inject fakes for tests.

## Documentation expectations

Write for beginner developers. Explain the concept before the command. Keep
examples short and placeholder-only. Before releasing, update the
[Changelog](README.md#changelog) and the affected sections of `README.md`, plus
`mcp/README.md` or `cli/README.md` when a tool's own guide changes.
