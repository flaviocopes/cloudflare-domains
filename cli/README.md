# Cloudflare Domains CLI

Cloudflare Domains CLI is a small Node.js command-line tool for inspecting
Cloudflare zones and managing their DNS records.

It is the everyday companion to the Registrar MCP server in this repository. The
MCP server handles domain discovery and guarded purchases. This CLI handles the
DNS work that comes after a domain is in your Cloudflare account.

## What it can do

- verify a Cloudflare API token
- list accessible zones
- list DNS records and their IDs
- create DNS records
- update selected fields on a DNS record
- delete a DNS record after confirmation

It does not register domains. Use the MCP server in `../mcp/` for that.

## Requirements

- Node.js 20 or newer
- a Cloudflare account with at least one zone
- a separate API token with `Zone:Read` and `DNS:Edit`
- macOS for Keychain storage, or an environment-based secret provider

## Install it

From this directory:

```bash
npm install
npm link
```

`npm link` makes the `cf-domains` command available in your terminal. If you do
not want to link it, replace `cf-domains` in every example with
`node src/cli.js`.

Check the installation:

```bash
cf-domains --help
```

## Create the right Cloudflare token

In the Cloudflare dashboard, create a custom API token with:

- `Zone` → `Zone` → `Read`
- `Zone` → `DNS` → `Edit`

Restrict its zone resources to only the domains you want this CLI to manage.

Do not reuse the Registrar token from the MCP server. The two programs do
different jobs, so two narrowly scoped tokens reduce the impact of a leaked or
misused credential.

## Store the token on macOS

Run:

```bash
cf-domains auth login
```

The CLI verifies the token before saving it to the **login** Keychain. It uses:

- service: `cloudflare.domains-cli`
- account: your macOS username

Check it:

```bash
cf-domains auth status
```

Remove it:

```bash
cf-domains auth logout
```

## Use another secret provider

On Linux, Windows, or a CI system, provide the token only to the process that
runs the CLI:

```bash
CLOUDFLARE_API_TOKEN=your-token cf-domains zones
```

Prefer your shell, CI platform, or password manager's secret feature instead
of writing the token into a committed `.env` file or shell history.

## List zones and records

```bash
cf-domains zones
cf-domains records example.com
```

The records command shows the record ID. You need that ID when updating or
deleting a record.

## Create a record

Create a proxied A record:

```bash
cf-domains add example.com \
  --type A \
  --name www \
  --content 203.0.113.10 \
  --ttl 1 \
  --proxied
```

Create a TXT record at the root of the domain:

```bash
cf-domains add example.com \
  --type TXT \
  --name @ \
  --content "hello world"
```

`@` means the zone root. A short name such as `www` becomes
`www.example.com`. A TTL of `1` asks Cloudflare to manage the TTL automatically.

## Update a record

First list the records, then copy the correct ID:

```bash
cf-domains records example.com
cf-domains update example.com record-id --content 203.0.113.11
```

Only the fields you pass are changed. Disable Cloudflare proxying with:

```bash
cf-domains update example.com record-id --dns-only
```

## Delete a record

```bash
cf-domains delete example.com record-id
```

The CLI asks for confirmation. `--yes` skips the prompt and is intended for
carefully reviewed automation:

```bash
cf-domains delete example.com record-id --yes
```

DNS mistakes can take a website or email offline. Always run `records` first.

## Configuration reference

| Variable | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Supplies the DNS token without Keychain. |
| `CLOUDFLARE_DNS_KEYCHAIN_SERVICE` | Overrides the Keychain service name. |
| `CLOUDFLARE_DNS_KEYCHAIN_ACCOUNT` | Overrides the Keychain account name. |

## Verify the source

```bash
npm run check
npm test
```

The tests use a fake HTTP transport. They do not access a Cloudflare account or
change DNS.

## Troubleshooting

**The command is not found**

Run `npm link` again, or use `node src/cli.js` from this directory.

**The zone cannot be found**

Check that the domain is already a Cloudflare zone and that the token's zone
scope includes it.

**Cloudflare rejects an update**

Some fields and proxy settings depend on the record type. List the current
record, verify its type, and pass only the field you need to change.

**The CLI says Keychain is unavailable**

Keychain support is macOS-only. Set `CLOUDFLARE_API_TOKEN` through your local
secret tooling on other operating systems.

## License

MIT.
