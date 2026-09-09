import assert from "node:assert/strict";
import test from "node:test";

import {
  CloudflareClient,
  normalizeRecordName,
  normalizeRecordPayload,
} from "../src/cloudflare.js";

test("normalizes root and relative DNS names", () => {
  assert.equal(normalizeRecordName("example.com", "@"), "example.com");
  assert.equal(normalizeRecordName("example.com", "www"), "www.example.com");
  assert.equal(normalizeRecordName("example.com", "api.example.com"), "api.example.com");
});

test("normalizes a complete record payload", () => {
  assert.deepEqual(
    normalizeRecordPayload("example.com", {
      type: "A",
      name: "www",
      content: "203.0.113.10",
      ttl: 1,
      proxied: true,
      ignored: "value",
    }),
    {
      type: "A",
      name: "www.example.com",
      content: "203.0.113.10",
      ttl: 1,
      proxied: true,
    },
  );
});

test("requires the fields Cloudflare needs when creating a record", () => {
  assert.throws(
    () => normalizeRecordPayload("example.com", { type: "A", name: "@" }),
    /Missing required DNS record field: content/,
  );
});

test("sends an authenticated create request with a normalized name", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });

    if (String(url).includes("/zones?")) {
      return Response.json({
        success: true,
        result: [{ id: "zone-123", name: "example.com" }],
        result_info: { total_pages: 1 },
      });
    }

    return Response.json({
      success: true,
      result: { id: "record-123", name: "www.example.com" },
    });
  };

  const client = new CloudflareClient("test-token", { fetchImpl });
  const result = await client.createRecord("example.com", {
    type: "A",
    name: "www",
    content: "203.0.113.10",
  });

  assert.equal(result.record.id, "record-123");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].options.method, "POST");
  assert.equal(requests[1].options.headers.Authorization, "Bearer test-token");
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    type: "A",
    name: "www.example.com",
    content: "203.0.113.10",
  });
});
