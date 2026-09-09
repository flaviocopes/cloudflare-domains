import { execFileSync } from "node:child_process";

export interface AppConfig {
  accountId: string;
  apiToken: string;
}

function readTokenFromKeychain(): string {
  const service =
    process.env.CLOUDFLARE_KEYCHAIN_SERVICE ?? "cloudflare.domain-registrar-mcp";
  const account = process.env.CLOUDFLARE_KEYCHAIN_ACCOUNT ?? process.env.USER;

  if (!account) {
    throw new Error(
      "CLOUDFLARE_KEYCHAIN_ACCOUNT is required when the current user cannot be detected.",
    );
  }

  try {
    return execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-a", account, "-s", service, "-w"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
  } catch {
    throw new Error(
      `Cloudflare API token was not found in the environment or macOS Keychain (service ${service}, account ${account}).`,
    );
  }
}

export function loadConfig(): AppConfig {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!accountId) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID is required.");
  }

  const apiToken =
    process.env.CLOUDFLARE_API_TOKEN?.trim() || readTokenFromKeychain();
  if (!apiToken) {
    throw new Error("Cloudflare API token is empty.");
  }

  return { accountId, apiToken };
}
