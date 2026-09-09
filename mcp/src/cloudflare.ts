import { extensionCandidates } from "./domain.js";

const API_BASE = "https://api.cloudflare.com/client/v4";

interface CloudflareErrorInfo {
  code?: number;
  message?: string;
}

interface CloudflareEnvelope<T> {
  success: boolean;
  result: T;
  errors?: CloudflareErrorInfo[];
  messages?: CloudflareErrorInfo[];
  result_info?: {
    cursor?: string;
  };
}

export interface DomainPricing {
  currency: string;
  registration_cost: string;
  renewal_cost: string;
}

export interface DomainAvailability {
  name: string;
  registrable: boolean;
  pricing?: DomainPricing;
  reason?:
    | "extension_not_supported_via_api"
    | "extension_not_supported"
    | "extension_disallows_registration"
    | "domain_premium"
    | "domain_unavailable";
  tier?: "standard" | "premium";
}

export interface SearchResult {
  domains: DomainAvailability[];
}

export interface ExtensionInfo {
  metadata: {
    name: string;
    tld: string;
  };
  registration_schema: unknown;
}

export interface RegistrationWorkflow {
  completed?: boolean;
  state?: string;
  links?: {
    self?: string;
    resource?: string;
  };
  error?: {
    code?: string;
    message?: string;
  } | null;
  [key: string]: unknown;
}

export class CloudflareApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details: CloudflareErrorInfo[] = [],
  ) {
    super(message);
    this.name = "CloudflareApiError";
  }
}

export interface RegistrarClient {
  checkDomain(domain: string): Promise<DomainAvailability>;
  searchDomains(query: string, limit: number): Promise<DomainAvailability[]>;
  getMinimumRegistrationYears(domain: string): Promise<number>;
  createRegistration(
    domain: string,
    years: number,
  ): Promise<RegistrationWorkflow>;
}

export class CloudflareRegistrarClient implements RegistrarClient {
  constructor(
    private readonly accountId: string,
    private readonly apiToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async checkDomain(domain: string): Promise<DomainAvailability> {
    const response = await this.request<{ domains: DomainAvailability[] }>(
      `/accounts/${this.accountId}/registrar/domain-check`,
      {
        method: "POST",
        body: JSON.stringify({ domains: [domain] }),
      },
    );

    const result = response.domains.find((item) => item.name === domain);
    if (!result) {
      throw new Error("Cloudflare did not return a result for this domain.");
    }

    return result;
  }

  async searchDomains(query: string, limit: number): Promise<DomainAvailability[]> {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    const result = await this.request<SearchResult>(
      `/accounts/${this.accountId}/registrar/domain-search?${params}`,
    );
    return result.domains;
  }

  async getMinimumRegistrationYears(domain: string): Promise<number> {
    for (const extension of extensionCandidates(domain)) {
      try {
        const info = await this.request<ExtensionInfo>(
          `/accounts/${this.accountId}/registrar/extensions/${encodeURIComponent(extension)}`,
        );
        return minimumYearsFromSchema(info.registration_schema);
      } catch (error) {
        if (error instanceof CloudflareApiError && error.status === 404) {
          continue;
        }
        throw error;
      }
    }

    throw new Error("Could not determine the extension's minimum registration term.");
  }

  async createRegistration(
    domain: string,
    years: number,
  ): Promise<RegistrationWorkflow> {
    return this.request<RegistrationWorkflow>(
      `/accounts/${this.accountId}/registrar/registrations`,
      {
        method: "POST",
        body: JSON.stringify({
          domain_name: domain,
          years,
          auto_renew: false,
          privacy_mode: "redaction",
        }),
      },
    );
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });

    let envelope: CloudflareEnvelope<T>;
    try {
      envelope = (await response.json()) as CloudflareEnvelope<T>;
    } catch {
      throw new CloudflareApiError(
        `Cloudflare returned an invalid response (${response.status}).`,
        response.status,
      );
    }

    if (!response.ok || !envelope.success) {
      const details = envelope.errors ?? [];
      const message =
        details.map((item) => item.message).filter(Boolean).join("; ") ||
        `Cloudflare request failed (${response.status}).`;
      throw new CloudflareApiError(message, response.status, details);
    }

    return envelope.result;
  }
}

export function minimumYearsFromSchema(schema: unknown): number {
  if (!schema || typeof schema !== "object") {
    return 1;
  }

  const properties = (schema as { properties?: unknown }).properties;
  if (!properties || typeof properties !== "object") {
    return 1;
  }

  const years = (properties as { years?: unknown }).years;
  if (!years || typeof years !== "object") {
    return 1;
  }

  const minimum = (years as { minimum?: unknown }).minimum;
  return typeof minimum === "number" && Number.isInteger(minimum) && minimum > 0
    ? minimum
    : 1;
}
