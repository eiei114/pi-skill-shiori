import { performance } from "node:perf_hooks";
import type { ShioriStats, ShioriTiming, TimingCounter } from "./types.js";

const TIMING_DECIMAL_PLACES = 2;
const TIMING_SCALE = 10 ** TIMING_DECIMAL_PLACES;

type MonotonicClock = () => number;

export function createTimingCounter(): TimingCounter {
  return {
    lastMs: 0,
    totalMs: 0,
    maxMs: 0,
    count: 0,
  };
}

export function createTiming(): ShioriTiming {
  return {
    inventoryRefresh: createTimingCounter(),
    retrieval: createTimingCounter(),
  };
}

export function createStats(): ShioriStats {
  return {
    inventoryCount: 0,
    duplicateCount: 0,
    candidateHitCount: 0,
    zeroCandidateCount: 0,
    loadedSkillCount: 0,
    explicitInvocationCount: 0,
    retrievalBackend: "token-match",
    suppressionStatus: "disabled",
    inventoryRefreshCount: 0,
    inventoryAutoRefreshCount: 0,
    timing: createTiming(),
  };
}

export function recordTiming(counter: TimingCounter, elapsedMs: number): void {
  const duration = roundMilliseconds(elapsedMs);
  counter.lastMs = duration;
  counter.totalMs = roundMilliseconds(counter.totalMs + duration);
  counter.maxMs = Math.max(counter.maxMs, duration);
  counter.count += 1;
}

export async function measureTiming<T>(
  counter: TimingCounter,
  operation: () => T | PromiseLike<T>,
  now: MonotonicClock = () => performance.now(),
): Promise<T> {
  const startedAt = now();
  const result = await operation();
  recordTiming(counter, now() - startedAt);
  return result;
}

export function formatTimingSummary(timing: ShioriTiming): string {
  return [
    "Timing (session-local)",
    `inventory refresh: ${formatTimingCounter(timing.inventoryRefresh)}`,
    `retrieval: ${formatTimingCounter(timing.retrieval)}`,
  ].join(" | ");
}

function formatTimingCounter(counter: TimingCounter): string {
  const count = Number.isFinite(counter.count) && counter.count > 0 ? Math.trunc(counter.count) : 0;
  return `count=${count} last=${formatMilliseconds(counter.lastMs)} total=${formatMilliseconds(counter.totalMs)} max=${formatMilliseconds(counter.maxMs)}`;
}

function formatMilliseconds(value: number): string {
  return `${roundMilliseconds(value).toFixed(TIMING_DECIMAL_PLACES)}ms`;
}

function roundMilliseconds(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round((value + Number.EPSILON) * TIMING_SCALE) / TIMING_SCALE;
}
