import assert from "node:assert/strict";
import test from "node:test";
import {
  attachRecommendationReason,
  classifyRecommendationReason,
  formatReasonBadge,
  formatReasonBadgeSuffix,
  LOW_CONFIDENCE_MARGIN,
} from "../src/recommendation-reason.ts";

const minScore = 0.62;

test("classifyRecommendationReason maps trigger matches to trigger", () => {
  assert.equal(classifyRecommendationReason("trigger", 0.95, minScore), "trigger");
});

test("classifyRecommendationReason maps strong description matches to description", () => {
  assert.equal(
    classifyRecommendationReason("description", minScore + LOW_CONFIDENCE_MARGIN + 0.05, minScore),
    "description",
  );
});

test("classifyRecommendationReason maps near-threshold matches to low-confidence", () => {
  assert.equal(
    classifyRecommendationReason("description", minScore + 0.01, minScore),
    "low-confidence",
  );
});

test("formatReasonBadge renders compact bounded labels", () => {
  assert.equal(formatReasonBadge("trigger"), "[trigger]");
  assert.equal(formatReasonBadge("description"), "[description]");
  assert.equal(formatReasonBadge("low-confidence"), "[low match]");
  assert.equal(formatReasonBadge(null), "");
});

test("attachRecommendationReason adds reason to candidates", () => {
  const candidate = attachRecommendationReason(
    {
      skill: {
        name: "auth-helper",
        description: "Auth flows",
        path: "/tmp/auth-helper/SKILL.md",
        source: "/tmp/.pi/skills",
      },
      score: 0.95,
      why: 'matched trigger "auth"',
    },
    "trigger",
    minScore,
  );

  assert.equal(candidate.reason, "trigger");
  assert.equal(formatReasonBadgeSuffix(candidate.reason), " [trigger]");
});
