import assert from "node:assert/strict";
import test from "node:test";
import {
  createStats,
  formatTimingSummary,
  measureTiming,
  recordTiming,
} from "../src/metrics.ts";

test("createStats initializes session timing counters to zero", () => {
  const stats = createStats();

  assert.deepEqual(stats.timing, {
    inventoryRefresh: { lastMs: 0, totalMs: 0, maxMs: 0, count: 0 },
    retrieval: { lastMs: 0, totalMs: 0, maxMs: 0, count: 0 },
  });
});

test("recordTiming rounds durations and accumulates totals and maxima", () => {
  const stats = createStats();

  recordTiming(stats.timing.retrieval, 12.345);
  recordTiming(stats.timing.retrieval, 3.456);

  assert.deepEqual(stats.timing.retrieval, {
    lastMs: 3.46,
    totalMs: 15.81,
    maxMs: 12.35,
    count: 2,
  });
});

test("measureTiming records successful work but not failures", async () => {
  const stats = createStats();
  let clock = 100;

  const result = await measureTiming(
    stats.timing.inventoryRefresh,
    async () => {
      clock = 112.345;
      return "done";
    },
    () => clock,
  );

  assert.equal(result, "done");
  assert.equal(stats.timing.inventoryRefresh.count, 1);
  assert.equal(stats.timing.inventoryRefresh.lastMs, 12.35);

  await assert.rejects(
    measureTiming(
      stats.timing.inventoryRefresh,
      async () => {
        clock = 999;
        throw new Error("refresh failed");
      },
      () => clock,
    ),
    /refresh failed/,
  );
  assert.equal(stats.timing.inventoryRefresh.count, 1);
});

test("formatTimingSummary uses finite zero values before any timing is recorded", () => {
  const summary = formatTimingSummary(createStats().timing);

  assert.match(summary, /inventory refresh: count=0 last=0\.00ms total=0\.00ms max=0\.00ms/);
  assert.match(summary, /retrieval: count=0 last=0\.00ms total=0\.00ms max=0\.00ms/);
  assert.doesNotMatch(summary, /NaN|Infinity/);
});
