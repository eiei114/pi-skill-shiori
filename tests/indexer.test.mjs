import assert from "node:assert/strict";
import test from "node:test";
import { buildFtsQuery } from "../src/indexer.js";

test("buildFtsQuery keeps unicode terms", () => {
  const query = buildFtsQuery("認証まわりのスキルを探して");
  assert.match(query, /認証\*/);
  assert.match(query, /スキル\*/);
});

test("buildFtsQuery keeps ascii terms", () => {
  const query = buildFtsQuery("browser scraping screenshot");
  assert.match(query, /browser\*/);
  assert.match(query, /scraping\*/);
  assert.match(query, /screenshot\*/);
});
