import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SECURITY_COMMAND = "/usr/bin/security";

export const SERVICE_NAME =
  process.env.CLOUDFLARE_DNS_KEYCHAIN_SERVICE ?? "cloudflare.domains-cli";
export const ACCOUNT_NAME =
  process.env.CLOUDFLARE_DNS_KEYCHAIN_ACCOUNT ?? process.env.USER ?? "cloudflare-user";

function loginKeychainPath() {
  return path.join(os.homedir(), "Library", "Keychains", "login.keychain-db");
}

function requireMacOS() {
  if (process.platform !== "darwin") {
    throw new Error(
      "macOS Keychain is not available on this system. Set CLOUDFLARE_API_TOKEN instead.",
    );
  }
}

function isMissingPasswordError(error) {
  const output = `${error.stderr ?? ""}\n${error.stdout ?? ""}`;
  return error.code === 44 || output.includes("could not be found");
}

export async function getToken() {
  const environmentToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (environmentToken) {
    return environmentToken;
  }

  requireMacOS();

  try {
    const { stdout } = await execFileAsync(SECURITY_COMMAND, [
      "find-generic-password",
      "-s",
      SERVICE_NAME,
      "-a",
      ACCOUNT_NAME,
      "-w",
      loginKeychainPath(),
    ]);

    return stdout.trim();
  } catch (error) {
    if (isMissingPasswordError(error)) {
      return null;
    }

    throw new Error(`Could not read Cloudflare token from Keychain: ${error.message}`);
  }
}

export async function saveToken(token) {
  requireMacOS();

  await execFileAsync(SECURITY_COMMAND, [
    "add-generic-password",
    "-s",
    SERVICE_NAME,
    "-a",
    ACCOUNT_NAME,
    "-w",
    token,
    "-U",
    loginKeychainPath(),
  ]);
}

export async function deleteToken() {
  requireMacOS();

  try {
    await execFileAsync(SECURITY_COMMAND, [
      "delete-generic-password",
      "-s",
      SERVICE_NAME,
      "-a",
      ACCOUNT_NAME,
      loginKeychainPath(),
    ]);

    return true;
  } catch (error) {
    if (isMissingPasswordError(error)) {
      return false;
    }

    throw new Error(`Could not delete Cloudflare token from Keychain: ${error.message}`);
  }
}
