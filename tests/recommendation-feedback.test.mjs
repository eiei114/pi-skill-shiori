import assert from "node:assert/strict";
import test from "node:test";
import { createRecommendationFeedback } from "../src/recommendation-feedback.ts";

test("createRecommendationFeedback returns an empty summary", () => {
  const feedback = createRecommendationFeedback();
  const summary = feedback.summarize();

  assert.equal(summary.totalOffers, 0);
  assert.equal(summary.totalCandidateSlots, 0);
  assert.equal(summary.totalLoaded, 0);
  assert.equal(summary.totalAbandoned, 0);
  assert.equal(summary.zeroCandidateQueries, 0);
  assert.equal(summary.followThroughRate, null);
  assert.deepEqual(summary.topSkills, []);
  assert.match(feedback.formatSummary(), /offers: 0/);
});

test("recordRecommendation tallies offers, loads, and follow-through rate", () => {
  const feedback = createRecommendationFeedback();

  feedback.recordRecommendation("command", ["auth-helper", "login-flow"], ["auth-helper"]);
  feedback.recordRecommendation("tool", ["deploy-kit"], ["deploy-kit"]);
  feedback.recordZeroCandidates("command");

  const summary = feedback.summarize();
  assert.equal(summary.totalOffers, 2);
  assert.equal(summary.totalCandidateSlots, 3);
  assert.equal(summary.totalLoaded, 2);
  assert.equal(summary.zeroCandidateQueries, 1);
  assert.equal(summary.followThroughRate, Number((2 / 3).toFixed(3)));
  assert.equal(summary.bySource.command.offers, 1);
  assert.equal(summary.bySource.command.loaded, 1);
  assert.equal(summary.bySource.command.zeroHits, 1);
  assert.equal(summary.bySource.tool.loaded, 1);
});

test("summarize keeps per-source counts aligned with totals at collection time", () => {
  const feedback = createRecommendationFeedback();

  feedback.recordRecommendation("command", ["auth-helper"], ["auth-helper"]);
  const earlier = feedback.summarize();

  feedback.recordRecommendation("command", ["login-flow", "token-helper"], ["login-flow"]);
  feedback.recordZeroCandidates("command");
  const later = feedback.summarize();

  for (const [summary, expected] of [
    [earlier, { offers: 1, candidateSlots: 1, loaded: 1, zeroHits: 0 }],
    [later, { offers: 2, candidateSlots: 3, loaded: 2, zeroHits: 1 }],
  ]) {
    assert.deepEqual(summary.bySource.command, expected);
    assert.equal(summary.totalOffers, expected.offers);
    assert.equal(summary.totalCandidateSlots, expected.candidateSlots);
    assert.equal(summary.totalLoaded, expected.loaded);
    assert.equal(summary.zeroCandidateQueries, expected.zeroHits);
  }
});

test("mutating a summary's per-source counts does not affect later summaries", () => {
  const feedback = createRecommendationFeedback();
  feedback.recordRecommendation("tool", ["deploy-kit"], ["deploy-kit"]);

  const summary = feedback.summarize();
  for (const counts of Object.values(summary.bySource)) {
    counts.offers = 99;
  }

  const later = feedback.summarize();
  assert.deepEqual(later.bySource, {
    "auto-inject": { offers: 0, candidateSlots: 0, loaded: 0, zeroHits: 0 },
    command: { offers: 0, candidateSlots: 0, loaded: 0, zeroHits: 0 },
    tool: { offers: 1, candidateSlots: 1, loaded: 1, zeroHits: 0 },
  });
  assert.equal(later.totalOffers, 1);
});

test("recordRecommendation marks review-only command flows as abandoned", () => {
  const feedback = createRecommendationFeedback();

  feedback.recordRecommendation("command", ["auth-helper"], []);

  const summary = feedback.summarize();
  assert.equal(summary.totalAbandoned, 1);
  assert.equal(summary.totalLoaded, 0);
});

test("recordSkillLoaded counts auto-inject follow-through", () => {
  const feedback = createRecommendationFeedback();

  feedback.recordRecommendation("auto-inject", ["auth-helper"]);
  feedback.recordSkillLoaded("auth-helper");
  feedback.recordSkillLoaded("unrelated-skill");

  const summary = feedback.summarize();
  assert.equal(summary.totalLoaded, 1);
  assert.deepEqual(summary.topSkills, [{ name: "auth-helper", offered: 1, loaded: 1 }]);
  assert.equal(summary.bySource["auto-inject"].loaded, 1);
});

test("skill tallies stay bounded to the configured retention limit", () => {
  const feedback = createRecommendationFeedback();

  for (let index = 0; index < 55; index += 1) {
    feedback.recordRecommendation("tool", [`skill-${index}`], [`skill-${index}`]);
  }

  const summary = feedback.summarize();
  assert.equal(summary.retention.skillEntries, 50);
  assert.equal(summary.topSkills.length, 10);
});
