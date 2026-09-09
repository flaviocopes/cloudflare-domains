import { randomUUID } from "node:crypto";
import type {
  DomainAvailability,
  RegistrarClient,
  RegistrationWorkflow,
} from "./cloudflare.js";
import { normalizeDomain } from "./domain.js";
import {
  centsToUsd,
  initialRegistrationTotalCents,
  MAX_PURCHASE_CENTS,
} from "./money.js";

const QUOTE_LIFETIME_MS = 5 * 60 * 1_000;

export interface AvailabilityResult {
  domain: string;
  registrable: boolean;
  tier: "standard" | "premium" | null;
  reason: string | null;
  pricing: {
    currency: string;
    registrationCost: string;
    renewalCost: string;
  } | null;
  source: "cloudflare_authoritative_check";
}

export interface PurchaseQuote {
  quoteId: string;
  domain: string;
  currency: "USD";
  registrationCost: string;
  renewalCost: string;
  years: number;
  totalCents: number;
  totalCost: string;
  maxAllowedCost: "20.00";
  autoRenew: false;
  expiresAt: string;
}

interface StoredQuote extends PurchaseQuote {
  expiresAtMs: number;
  used: boolean;
}

export interface PurchaseRequest {
  quoteId: string;
  domain: string;
  currency: string;
  totalCents: number;
}

export type PurchaseApproval = (quote: PurchaseQuote) => Promise<boolean>;

export class DomainService {
  private readonly quotes = new Map<string, StoredQuote>();

  constructor(
    private readonly client: RegistrarClient,
    private readonly now: () => number = Date.now,
  ) {}

  async checkAvailability(input: string): Promise<AvailabilityResult> {
    const domain = normalizeDomain(input);
    const checked = await this.client.checkDomain(domain);
    return availabilityResult(domain, checked);
  }

  async search(query: string, limit: number): Promise<AvailabilityResult[]> {
    const results = await this.client.searchDomains(query.trim(), limit);
    return results.map((item) => availabilityResult(item.name, item));
  }

  async createQuote(input: string): Promise<PurchaseQuote> {
    this.removeExpiredQuotes();
    const domain = normalizeDomain(input);
    const checked = await this.client.checkDomain(domain);
    assertPurchasable(checked);

    const pricing = checked.pricing!;
    if (pricing.currency !== "USD") {
      throw new Error(
        `The quote currency is ${pricing.currency}; this server only permits USD purchases.`,
      );
    }

    const years = await this.client.getMinimumRegistrationYears(domain);
    const totalCents = initialRegistrationTotalCents(
      pricing.registration_cost,
      pricing.renewal_cost,
      years,
    );
    enforcePurchaseLimit(totalCents);

    const createdAt = this.now();
    const stored: StoredQuote = {
      quoteId: randomUUID(),
      domain,
      currency: "USD",
      registrationCost: pricing.registration_cost,
      renewalCost: pricing.renewal_cost,
      years,
      totalCents,
      totalCost: centsToUsd(totalCents),
      maxAllowedCost: "20.00",
      autoRenew: false,
      expiresAt: new Date(createdAt + QUOTE_LIFETIME_MS).toISOString(),
      expiresAtMs: createdAt + QUOTE_LIFETIME_MS,
      used: false,
    };

    this.quotes.set(stored.quoteId, stored);
    return publicQuote(stored);
  }

  async purchase(request: PurchaseRequest, approve: PurchaseApproval): Promise<{
    quote: PurchaseQuote;
    workflow: RegistrationWorkflow;
  }> {
    const quote = this.quotes.get(request.quoteId);
    if (!quote || quote.expiresAtMs <= this.now()) {
      throw new Error("The purchase quote is missing or expired. Request a new quote.");
    }
    if (quote.used) {
      throw new Error("This purchase quote has already been used.");
    }
    if (
      request.domain !== quote.domain ||
      request.currency !== quote.currency ||
      request.totalCents !== quote.totalCents
    ) {
      throw new Error("The approved purchase details do not match the quote.");
    }

    enforcePurchaseLimit(quote.totalCents);

    const checked = await this.client.checkDomain(quote.domain);
    assertPurchasable(checked);
    const pricing = checked.pricing!;
    if (pricing.currency !== "USD") {
      throw new Error("The live quote currency changed. Request a new quote.");
    }

    const years = await this.client.getMinimumRegistrationYears(quote.domain);
    const liveTotalCents = initialRegistrationTotalCents(
      pricing.registration_cost,
      pricing.renewal_cost,
      years,
    );
    enforcePurchaseLimit(liveTotalCents);

    if (
      liveTotalCents !== quote.totalCents ||
      years !== quote.years ||
      pricing.registration_cost !== quote.registrationCost ||
      pricing.renewal_cost !== quote.renewalCost
    ) {
      throw new Error("The live price or registration term changed. Request a new quote.");
    }

    // Consume the quote before awaiting approval so concurrent tool calls cannot
    // present two approval forms and create two registration attempts.
    quote.used = true;
    const approved = await approve(publicQuote(quote));
    if (!approved) {
      throw new Error("The domain purchase was not approved by the user.");
    }

    const workflow = await this.client.createRegistration(quote.domain, quote.years);
    return { quote: publicQuote(quote), workflow };
  }

  private removeExpiredQuotes(): void {
    const currentTime = this.now();
    for (const [quoteId, quote] of this.quotes) {
      if (quote.expiresAtMs <= currentTime || quote.used) {
        this.quotes.delete(quoteId);
      }
    }
  }
}

function availabilityResult(
  domain: string,
  checked: DomainAvailability,
): AvailabilityResult {
  return {
    domain,
    registrable: checked.registrable,
    tier: checked.tier ?? null,
    reason: checked.reason ?? null,
    pricing: checked.pricing
      ? {
          currency: checked.pricing.currency,
          registrationCost: checked.pricing.registration_cost,
          renewalCost: checked.pricing.renewal_cost,
        }
      : null,
    source: "cloudflare_authoritative_check",
  };
}

function assertPurchasable(checked: DomainAvailability): void {
  if (!checked.registrable) {
    throw new Error(
      `The domain cannot be purchased through the API: ${checked.reason ?? "not registrable"}.`,
    );
  }
  if (checked.tier === "premium") {
    throw new Error("Premium domain purchases are not permitted.");
  }
  if (!checked.pricing) {
    throw new Error("Cloudflare did not return pricing for this domain.");
  }
}

function enforcePurchaseLimit(totalCents: number): void {
  if (totalCents > MAX_PURCHASE_CENTS) {
    throw new Error(
      `The initial charge is $${centsToUsd(totalCents)}, above the $20.00 limit.`,
    );
  }
}

function publicQuote(quote: StoredQuote): PurchaseQuote {
  return {
    quoteId: quote.quoteId,
    domain: quote.domain,
    currency: quote.currency,
    registrationCost: quote.registrationCost,
    renewalCost: quote.renewalCost,
    years: quote.years,
    totalCents: quote.totalCents,
    totalCost: quote.totalCost,
    maxAllowedCost: quote.maxAllowedCost,
    autoRenew: quote.autoRenew,
    expiresAt: quote.expiresAt,
  };
}
