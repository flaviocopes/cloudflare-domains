import assert from "node:assert/strict";
import test from "node:test";
import {
  centsToUsd,
  initialRegistrationTotalCents,
  usdToCents,
} from "../src/money.js";

test("converts USD strings without floating-point arithmetic", () => {
  assert.equal(usdToCents("8.57"), 857);
  assert.equal(usdToCents("20"), 2_000);
  assert.equal(centsToUsd(1_011), "10.11");
});

test("calculates the complete initial multi-year charge", () => {
  assert.equal(initialRegistrationTotalCents("10.00", "9.00", 2), 1_900);
  assert.equal(initialRegistrationTotalCents("10.00", "9.00", 3), 2_800);
});
