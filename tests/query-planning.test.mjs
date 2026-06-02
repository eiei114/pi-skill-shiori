import assert from "node:assert/strict";
import test from "node:test";
import { buildRetrievalQueries } from "../src/query.js";

test("buildRetrievalQueries expands planning intent", () => {
  const variants = buildRetrievalQueries("計画を立てたい");
  assert.ok(variants.some((q) => q.includes("to-prd")));
  assert.ok(variants.some((q) => q.includes("grill")));
});
