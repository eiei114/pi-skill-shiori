import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateAlwaysVisible,
  formatAlwaysVisibleDiagnostics,
  normalizeAlwaysVisible,
} from "../src/always-visible.js";

const skills = [
  {
    name: "pi-skill-shiori",
    description: "Skill selection layer",
    path: "/tmp/pi-skill-shiori/SKILL.md",
    source: "/tmp/.pi/skills",
  },
  {
    name: "safety-helper",
    description: "Safety-critical helper",
    path: "/tmp/safety-helper/SKILL.md",
    source: "/tmp/.pi/skills",
  },
];

test("normalizeAlwaysVisible deduplicates policy entries", () => {
  const result = normalizeAlwaysVisible(["pi-skill-shiori", "safety-helper", "pi-skill-shiori"]);
  assert.deepEqual(result.allowlist, ["pi-skill-shiori", "safety-helper"]);
  assert.deepEqual(result.duplicates, ["pi-skill-shiori"]);
});

test("evaluateAlwaysVisible reports missing configured skills", () => {
  const diagnostics = evaluateAlwaysVisible(["pi-skill-shiori", "ghost-skill"], skills);
  assert.deepEqual(diagnostics.resolved, ["pi-skill-shiori"]);
  assert.deepEqual(diagnostics.missing, ["ghost-skill"]);
  assert.deepEqual(diagnostics.duplicates, []);
});

test("formatAlwaysVisibleDiagnostics includes missing and duplicate lines", () => {
  const lines = formatAlwaysVisibleDiagnostics({
    resolved: ["pi-skill-shiori"],
    missing: ["ghost-skill"],
    duplicates: ["pi-skill-shiori"],
  });
  assert.ok(lines.some((line) => line.includes("alwaysVisible resolved")));
  assert.ok(lines.some((line) => line.includes("alwaysVisible missing: ghost-skill")));
  assert.ok(lines.some((line) => line.includes("alwaysVisible duplicates: pi-skill-shiori")));
});
