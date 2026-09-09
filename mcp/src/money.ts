export const MAX_PURCHASE_CENTS = 2_000;

export function usdToCents(value: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) {
    throw new Error(`Unexpected USD amount: ${value}`);
  }

  const whole = Number.parseInt(match[1], 10);
  const fractional = (match[2] ?? "").padEnd(2, "0");
  const cents = whole * 100 + Number.parseInt(fractional || "0", 10);

  if (!Number.isSafeInteger(cents)) {
    throw new Error("The quoted amount is too large to process safely.");
  }

  return cents;
}

export function centsToUsd(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error("Invalid cent amount.");
  }

  return (cents / 100).toFixed(2);
}

export function initialRegistrationTotalCents(
  registrationCost: string,
  renewalCost: string,
  years: number,
): number {
  if (!Number.isInteger(years) || years < 1 || years > 10) {
    throw new Error("Registration years must be an integer from 1 to 10.");
  }

  return usdToCents(registrationCost) + usdToCents(renewalCost) * (years - 1);
}
