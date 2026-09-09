const API_BASE_URL = "https://api.cloudflare.com/client/v4";

export class CloudflareApiError extends Error {
  constructor(message, { status, errors = [] } = {}) {
    super(message);
    this.name = "CloudflareApiError";
    this.status = status;
    this.errors = errors;
  }
}

export class CloudflareClient {
  constructor(token, { fetchImpl = globalThis.fetch } = {}) {
    if (!token) {
      throw new Error("Missing Cloudflare API token. Run `cf-domains auth login` first.");
    }

    if (typeof fetchImpl !== "function") {
      throw new Error("This CLI needs a fetch implementation. Use Node.js 20 or newer.");
    }

    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  async verifyToken() {
    return this.request("/user/tokens/verify");
  }

  async listZones() {
    return this.paginatedRequest("/zones", {
      params: {
        per_page: "50",
        order: "name",
        direction: "asc",
      },
    });
  }

  async getZoneByName(domain) {
    const zones = await this.paginatedRequest("/zones", {
      params: {
        name: domain,
        per_page: "50",
      },
    });

    const exactMatch = zones.find((zone) => zone.name === domain);
    if (!exactMatch) {
      throw new Error(`Could not find a Cloudflare zone named "${domain}".`);
    }

    return exactMatch;
  }

  async listRecords(domain) {
    const zone = await this.getZoneByName(domain);
    const records = await this.paginatedRequest(`/zones/${zone.id}/dns_records`, {
      params: {
        per_page: "100",
        order: "type",
        direction: "asc",
      },
    });

    return { zone, records };
  }

  async createRecord(domain, record) {
    const zone = await this.getZoneByName(domain);
    const response = await this.request(`/zones/${zone.id}/dns_records`, {
      method: "POST",
      body: normalizeRecordPayload(domain, record),
    });

    return { zone, record: response.result };
  }

  async updateRecord(domain, recordId, updates) {
    const zone = await this.getZoneByName(domain);
    const response = await this.request(`/zones/${zone.id}/dns_records/${recordId}`, {
      method: "PATCH",
      body: normalizeRecordPayload(domain, updates, { partial: true }),
    });

    return { zone, record: response.result };
  }

  async deleteRecord(domain, recordId) {
    const zone = await this.getZoneByName(domain);
    const response = await this.request(`/zones/${zone.id}/dns_records/${recordId}`, {
      method: "DELETE",
    });

    return { zone, result: response.result };
  }

  async paginatedRequest(path, { params = {} } = {}) {
    const results = [];
    let page = 1;
    let totalPages = 1;

    do {
      const response = await this.request(path, {
        params: {
          ...params,
          page: String(page),
        },
      });

      results.push(...response.result);
      totalPages = response.result_info?.total_pages ?? 1;
      page += 1;
    } while (page <= totalPages);

    return results;
  }

  async request(path, { method = "GET", params = {}, body } = {}) {
    const url = new URL(`${API_BASE_URL}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    }

    const response = await this.fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || data?.success === false) {
      const errors = data?.errors ?? [];
      const detail = errors.map((error) => error.message).filter(Boolean).join("; ");
      const message = detail || `Cloudflare API request failed with status ${response.status}`;

      throw new CloudflareApiError(message, {
        status: response.status,
        errors,
      });
    }

    return data;
  }
}

export function normalizeRecordName(domain, name) {
  if (!name || name === "@") {
    return domain;
  }

  return name.endsWith(`.${domain}`) || name === domain ? name : `${name}.${domain}`;
}

export function normalizeRecordPayload(domain, record, { partial = false } = {}) {
  const payload = {};

  for (const key of ["type", "name", "content", "ttl", "proxied", "comment"]) {
    if (record[key] !== undefined) {
      payload[key] = record[key];
    }
  }

  if (payload.name !== undefined) {
    payload.name = normalizeRecordName(domain, payload.name);
  }

  if (!partial) {
    for (const key of ["type", "name", "content"]) {
      if (payload[key] === undefined || payload[key] === "") {
        throw new Error(`Missing required DNS record field: ${key}`);
      }
    }
  }

  return payload;
}
