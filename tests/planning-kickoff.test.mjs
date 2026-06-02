import assert from "node:assert/strict";
import test from "node:test";
import { formatPlanningKickoffMessage, isPlanningIntent } from "../src/planning-kickoff.js";

test("isPlanningIntent matches Japanese planning phrases", () => {
  assert.equal(isPlanningIntent("計画を立てたい"), true);
  assert.equal(isPlanningIntent("browser scraping"), false);
});

test("formatPlanningKickoffMessage returns dev-plan template without skill bodies", () => {
  const message = formatPlanningKickoffMessage("計画を立てたい", [
    {
      skill: { name: "to-prd", description: "PRD", path: "/tmp/to-prd/SKILL.md", source: "/tmp" },
      score: 1,
      why: "matched",
    },
  ]);
  assert.match(message, /今日やる開発計画の型/);
  assert.match(message, /対象:/);
  assert.match(message, /to-prd/);
  assert.doesNotMatch(message, /^# /m);
});
