# Cloudflare Domain MCP

Cloudflare Domain MCP gives AI clients a small set of tools for Cloudflare
Registrar.

You can ask your AI client to:

- search for domain ideas
- check whether one domain is available
- show the current registration and renewal price
- prepare a short-lived purchase quote
- register a domain after you approve the exact domain and price

The server runs locally through **stdio**. Your AI client starts it as a child
process and exchanges MCP messages through standard input and output.

The Cloudflare API token stays on your computer. On macOS, the simplest option
is to store it in the login Keychain.

> A successful domain registration is billable and non-refundable. Read the
> security section before enabling `purchase_domain`.

## Safety rules

The server enforces these rules in code:

- The complete initial charge cannot exceed **$20 USD**.
- Premium domains are rejected.
- Non-USD purchases are rejected.
- Quotes expire after five minutes.
- Quotes can be used only once.
- Availability, price, and registration term are checked again before approval.
- The MCP client must support elicitation and receive an explicit `true` answer.
- Auto-renewal is disabled in the registration request.

These rules do not depend on the AI following a prompt correctly.

## What is MCP?

**MCP**, or Model Context Protocol, is a standard way for an AI client to call
external tools.

This project is an MCP **server**. Cursor, Codex, or another MCP **client**
starts the server and discovers its four tools.

The server does not contain an AI model. It validates tool input, talks to the
Cloudflare API, applies safety rules, and returns structured results.

## The four tools

### `search_domains`

Searches for suggestions based on a phrase or partial domain.

Search results are useful for discovery. They are not authoritative purchase
results.

### `check_domain_availability`

Checks one exact domain against the registry and returns current availability
and pricing.

This tool never reserves or purchases anything.

### `quote_domain_purchase`

Checks the domain, reads the registry's minimum term, calculates the complete
initial charge, and creates a five-minute quote.

This tool never purchases anything.

### `purchase_domain`

Accepts the exact quote details, repeats the live checks, and asks the MCP
client to show you a confirmation form.

Cloudflare's registration endpoint is called only after you explicitly approve
that form.

## Requirements

You need:

- Node.js 20 or newer
- a Cloudflare account ID
- a Cloudflare API token with Registrar write permission
- a valid default payment method in Cloudflare
- a default registrant contact
- acceptance of Cloudflare's Domain Registration Agreement
- an MCP client with stdio and elicitation support for purchases

Cloudflare's Registrar API is currently a beta. Only a subset of extensions can
be registered through the API.

## Install the project

Clone this repository and open its `mcp` folder in a terminal.

Install the dependencies:

```bash
npm install
```

Build the TypeScript source:

```bash
npm run build
```

Run the automated tests:

```bash
npm test
```

Confirm that an MCP client can start the server and discover its tools:

```bash
npm run smoke
```

## Create the Cloudflare token

Open this URL after replacing `<ACCOUNT_ID>`:

```text
https://dash.cloudflare.com/<ACCOUNT_ID>/api-tokens
```

Create a user API token with Registrar write permission. Scope it to the
account you will use for registrations.

Do not put the token in this project folder.

## Store the token on macOS

The included helper stores the token in the **login** Keychain:

```bash
npm run keychain:store
```

The default Keychain identity is:

- service: `cloudflare.domain-registrar-mcp`
- account: your macOS username

The helper never writes the token to a file.

You can also create the item manually in Keychain Access. Select **login**, not
iCloud, because local command-line processes need to read this item.

## Configure an MCP client

First, find the absolute Node.js path:

```bash
which node
```

Then find the absolute project path:

```bash
pwd
```

Use those two values in your client configuration.

### Cursor

Copy `examples/cursor-mcp.json` to `~/.cursor/mcp.json`, or merge its server
entry into your existing file.

Replace:

- `/absolute/path/to/node`
- `/absolute/path/to/cloudflare-domain-mcp`
- `your-cloudflare-account-id`
- `your-macos-username`

Restart Cursor after saving the file.

### Codex

Copy the contents of `examples/codex-config.toml` into
`~/.codex/config.toml`.

Alternatively, register the server through the CLI:

```bash
codex mcp add cloudflare-domains \
  --env CLOUDFLARE_ACCOUNT_ID=your-cloudflare-account-id \
  --env CLOUDFLARE_KEYCHAIN_SERVICE=cloudflare.domain-registrar-mcp \
  --env CLOUDFLARE_KEYCHAIN_ACCOUNT=your-macos-username \
  -- /absolute/path/to/node \
  /absolute/path/to/cloudflare-domain-mcp/dist/server.js
```

Restart Codex after registering the server.

### Another MCP client

Use a stdio configuration with:

- command: the absolute path to Node.js
- first argument: the absolute path to `dist/server.js`
- `CLOUDFLARE_ACCOUNT_ID` in the process environment
- the Keychain service and account when using macOS Keychain

Purchases require the client to support MCP form elicitation. The read-only
tools still work in clients without elicitation.

## Test a real availability check

The live-check script calls only `check_domain_availability`:

```bash
CLOUDFLARE_ACCOUNT_ID=your-cloudflare-account-id \
npm run live-check -- a-domain-you-want-to-check.dev
```

This command never creates a quote or registration.

## Example prompts

Once your client lists the tools, try:

- `Check whether northstarstudio.dev is available on Cloudflare.`
- `Find five domain ideas for a small gardening app.`
- `Quote northstarstudio.dev, but do not purchase it.`
- `Purchase northstarstudio.dev if the complete initial charge is at most $20.`

The final prompt still triggers the server's own approval request.

## Environment variables

### `CLOUDFLARE_ACCOUNT_ID`

Required. This selects the Cloudflare account used by the Registrar API.

### `CLOUDFLARE_API_TOKEN`

Optional. When present, the server reads the token from this environment
variable instead of Keychain.

Use your MCP client's secret handling or an external secret manager. Do not
save a real token in a committed configuration file.

### `CLOUDFLARE_KEYCHAIN_SERVICE`

Optional on macOS. Defaults to `cloudflare.domain-registrar-mcp`.

### `CLOUDFLARE_KEYCHAIN_ACCOUNT`

Optional on macOS. Defaults to the current `$USER` value.

## Useful commands

```bash
npm run check
npm test
npm run build
npm run smoke
npm run live-check -- northstarstudio.dev
npm start
```

`npm start` runs the stdio server directly. It will appear to wait because an
MCP client must send protocol messages to standard input.

## Troubleshooting

### The client says the server closed

Run the build first:

```bash
npm run build
```

Check that the Node and `dist/server.js` paths in the client configuration are
absolute and correct.

### The token was not found

On macOS, make sure the item is in the **login** Keychain. Check the service and
account values:

```bash
security find-generic-password \
  -a your-macos-username \
  -s cloudflare.domain-registrar-mcp
```

Do not add `-w` while troubleshooting in a shared terminal. That option prints
the token.

### Cloudflare returns an authentication error

Create a user API token with Registrar write permission. A token intended for
Workers or DNS management does not automatically include Registrar access.

### A domain appears in search but cannot be quoted

Search uses discovery data. The quote uses an authoritative check. The domain
may already be unavailable, or its extension may not be supported by the API
beta.

### A quote expired

Request a new quote. Quotes intentionally expire after five minutes and are
stored only in the running MCP process.

### The client cannot purchase

The client must advertise MCP form elicitation support. The server blocks the
registration when that capability is missing.

## Project structure

```text
├── examples/
│   ├── codex-config.toml
│   └── cursor-mcp.json
├── scripts/
│   ├── live-check.mjs
│   ├── smoke.mjs
│   └── store-token-macos.sh
├── src/
│   ├── cloudflare.ts
│   ├── config.ts
│   ├── domain.ts
│   ├── money.ts
│   ├── server.ts
│   └── service.ts
└── test/
```

Start with `src/server.ts` to see the MCP tools. Then read `src/service.ts` for
the quote and purchase rules.

## Official references

- Cloudflare Registrar API:
  <https://developers.cloudflare.com/registrar/registrar-api/>
- Cloudflare Registrar API reference:
  <https://developers.cloudflare.com/api/resources/registrar/>
- Model Context Protocol:
  <https://modelcontextprotocol.io/>
- MCP elicitation:
  <https://modelcontextprotocol.io/docs/learn/client-concepts#elicitation>
- Cursor MCP configuration:
  <https://docs.cursor.com/context/model-context-protocol>
- Codex MCP configuration:
  <https://learn.chatgpt.com/docs/extend/mcp>

## License

MIT. See `LICENSE`.
