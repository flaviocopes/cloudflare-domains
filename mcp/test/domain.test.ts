import assert from "node:assert/strict";
import test from "node:test";
import { extensionCandidates, normalizeDomain } from "../src/domain.js";

test("normalizes a domain", () => {
  assert.equal(normalizeDomain(" Example.XYZ. "), "example.xyz");
});

test("rejects invalid and Unicode domains", () => {
  assert.throws(() => normalizeDomain("localhost"), /registrable domain/);
  assert.throws(() => normalizeDomain("-example.com"), /not valid/);
  assert.throws(() => normalizeDomain("café.com"), /Unicode/);
});

test("builds extension candidates from longest to shortest", () => {
  assert.deepEqual(extensionCandidates("example.co.uk"), ["co.uk", "uk"]);
});
