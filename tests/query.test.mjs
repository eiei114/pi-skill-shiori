import assert from "node:assert/strict";
import test from "node:test";
import { buildRetrievalQueries } from "../src/query.js";

test("buildRetrievalQueries expands Japanese auth intent to English aliases", () => {
  const variants = buildRetrievalQueries("認証まわりのスキルを探して");
  assert.ok(variants.some((q) => q.includes("auth")));
  assert.ok(variants.some((q) => q.includes("skill")));
});

test("buildRetrievalQueries keeps the original prompt", () => {
  const variants = buildRetrievalQueries("browser scraping screenshot");
  assert.ok(variants.includes("browser scraping screenshot"));
});

test("buildRetrievalQueries expands X API social data intent", () => {
  const variants = buildRetrievalQueries("X API follower export");
  assert.ok(variants.some((q) => q.includes("tweet search social media data")));
  assert.ok(variants.some((q) => q.includes("twitter timeline follower export")));
});
