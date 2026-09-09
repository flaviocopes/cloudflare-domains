import assert from "node:assert/strict";
import test from "node:test";
import type {
  DomainAvailability,
  RegistrarClient,
  RegistrationWorkflow,
} from "../src/cloudflare.js";
import { DomainService } from "../src/service.js";

class FakeRegistrar implements RegistrarClient {
  availability: DomainAvailability = {
    name: "example.xyz",
    registrable: true,
    tier: "standard",
    pricing: {
      currency: "USD",
      registration_cost: "10.00",
      renewal_cost: "10.00",
    },
  };

  minimumYears = 1;
  registrations: Array<{ domain: string; years: number }> = [];

  async checkDomain(): Promise<DomainAvailability> {
    return structuredClone(this.availability);
  }

  async searchDomains(): Promise<DomainAvailability[]> {
    return [structuredClone(this.availability)];
  }

  async getMinimumRegistrationYears(): Promise<number> {
    return this.minimumYears;
  }

  async createRegistration(
    domain: string,
    years: number,
  ): Promise<RegistrationWorkflow> {
    this.registrations.push({ domain, years });
    return { completed: true, state: "succeeded" };
  }
}

test("availability checks are read-only and include live pricing", async () => {
  const client = new FakeRegistrar();
  const service = new DomainService(client);

  const result = await service.checkAvailability("EXAMPLE.XYZ");

  assert.equal(result.registrable, true);
  assert.equal(result.pricing?.registrationCost, "10.00");
  assert.deepEqual(client.registrations, []);
});

test("rejects a complete initial charge above $20", async () => {
  const client = new FakeRegistrar();
  client.minimumYears = 3;
  const service = new DomainService(client);

  await assert.rejects(() => service.createQuote("example.xyz"), /above the \$20/);
});

test("purchases only the exact approved quote and disables replay", async () => {
  const client = new FakeRegistrar();
  const service = new DomainService(client, () => Date.parse("2026-08-04T12:00:00Z"));
  const quote = await service.createQuote("example.xyz");

  await assert.rejects(
    () =>
      service.purchase(
        {
          quoteId: quote.quoteId,
          domain: "different.xyz",
          currency: "USD",
          totalCents: quote.totalCents,
        },
        async () => true,
      ),
    /do not match/,
  );

  const result = await service.purchase(
    {
      quoteId: quote.quoteId,
      domain: quote.domain,
      currency: quote.currency,
      totalCents: quote.totalCents,
    },
    async () => true,
  );

  assert.equal(result.workflow.state, "succeeded");
  assert.deepEqual(client.registrations, [{ domain: "example.xyz", years: 1 }]);
  await assert.rejects(
    () =>
      service.purchase(
        {
          quoteId: quote.quoteId,
          domain: quote.domain,
          currency: quote.currency,
          totalCents: quote.totalCents,
        },
        async () => true,
      ),
    /already been used/,
  );
});

test("requires a new approval when the live price changes", async () => {
  const client = new FakeRegistrar();
  const service = new DomainService(client);
  const quote = await service.createQuote("example.xyz");
  client.availability.pricing!.registration_cost = "11.00";

  await assert.rejects(
    () =>
      service.purchase(
        {
          quoteId: quote.quoteId,
          domain: quote.domain,
          currency: quote.currency,
          totalCents: quote.totalCents,
        },
        async () => true,
      ),
    /live price.*changed/i,
  );
  assert.deepEqual(client.registrations, []);
});

test("requires explicit user approval before registration", async () => {
  const client = new FakeRegistrar();
  const service = new DomainService(client);
  const quote = await service.createQuote("example.xyz");

  await assert.rejects(
    () =>
      service.purchase(
        {
          quoteId: quote.quoteId,
          domain: quote.domain,
          currency: quote.currency,
          totalCents: quote.totalCents,
        },
        async () => false,
      ),
    /not approved/i,
  );

  assert.deepEqual(client.registrations, []);
});

test("allows only one concurrent purchase attempt per quote", async () => {
  const client = new FakeRegistrar();
  const service = new DomainService(client);
  const quote = await service.createQuote("example.xyz");
  const request = {
    quoteId: quote.quoteId,
    domain: quote.domain,
    currency: quote.currency,
    totalCents: quote.totalCents,
  };

  let approvalStarted!: () => void;
  const approvalIsOpen = new Promise<void>((resolve) => {
    approvalStarted = resolve;
  });
  let approveFirst!: (approved: boolean) => void;
  const firstDecision = new Promise<boolean>((resolve) => {
    approveFirst = resolve;
  });

  const firstPurchase = service.purchase(request, async () => {
    approvalStarted();
    return firstDecision;
  });
  await approvalIsOpen;

  await assert.rejects(
    () => service.purchase(request, async () => true),
    /already been used/,
  );

  approveFirst(true);
  await firstPurchase;
  assert.deepEqual(client.registrations, [{ domain: "example.xyz", years: 1 }]);
});
