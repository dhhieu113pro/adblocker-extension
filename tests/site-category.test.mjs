import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDomain, classifySite } from "../src/site-category.mjs";

test("normalizes URLs without retaining path or query", () => {
  assert.equal(
    normalizeDomain("https://news.ycombinator.com/item?id=1#comments"),
    "news.ycombinator.com",
  );
  assert.equal(normalizeDomain("WWW.Example.com"), "example.com");
  assert.equal(normalizeDomain("not a valid host value"), "");
});

test("classifies known high-confidence domains", () => {
  const result = classifySite({ domain: "youtube.com" });
  assert.equal(result.category, "Video/Streaming");
  assert.equal(result.source, "offline");
  assert.ok(result.confidence >= 90);
});

test("uses heuristic metadata for unknown shopping sites", () => {
  const result = classifySite({
    domain: "shop-example.test",
    metadata: "products shopping cart checkout deals",
  });
  assert.equal(result.category, "Shopping");
  assert.equal(result.source, "heuristic");
  assert.ok(result.confidence > 0);
});

test("falls back to Other without a meaningful category signal", () => {
  assert.deepEqual(classifySite({ domain: "unknown-example.test" }), {
    category: "Other",
    confidence: 0,
    source: "fallback",
  });
});
