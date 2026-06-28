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
