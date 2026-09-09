const DOMAIN_MAX_LENGTH = 253;
const LABEL_MAX_LENGTH = 63;
const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function normalizeDomain(input: string): string {
  const domain = input.trim().toLowerCase().replace(/\.$/, "");

  if (!domain || domain.length > DOMAIN_MAX_LENGTH || !domain.includes(".")) {
    throw new Error("Provide a registrable domain such as example.com.");
  }

  if (!/^[\x00-\x7F]+$/.test(domain)) {
    throw new Error("Unicode domain names are not supported.");
  }

  const labels = domain.split(".");
  if (
    labels.some(
      (label) =>
        label.length === 0 ||
        label.length > LABEL_MAX_LENGTH ||
        !LABEL_PATTERN.test(label),
    )
  ) {
    throw new Error("The domain name is not valid.");
  }

  return domain;
}

export function extensionCandidates(domain: string): string[] {
  const labels = normalizeDomain(domain).split(".");
  const candidates: string[] = [];

  for (let index = 1; index < labels.length; index += 1) {
    candidates.push(labels.slice(index).join("."));
  }

  return candidates;
}
