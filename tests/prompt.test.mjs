import assert from "node:assert/strict";
import test from "node:test";
import { formatLoadedSkillsSummary, formatRecommendKickoffMessage } from "../src/prompt.js";

test("formatRecommendKickoffMessage embeds multiple pre-loaded skills", () => {
  const message = formatRecommendKickoffMessage("browser scraping screenshot", [
    {
      candidate: {
        skill: {
          name: "playwright-cli",
          description: "Browser automation",
          path: "/tmp/playwright-cli/SKILL.md",
          source: "/tmp/.pi/skills",
        },
        score: 1,
        why: "matched skill description",
      },
      content: "# Playwright\n\nUse browser automation.",
    },
    {
      candidate: {
        skill: {
          name: "gstack-browse",
          description: "Headless browser QA",
          path: "/tmp/gstack-browse/SKILL.md",
          source: "/tmp/.pi/skills",
        },
        score: 0.8,
        why: "matched skill description",
      },
      content: "# GStack\n\nBrowse the web.",
    },
  ]);

  assert.match(message, /browser scraping screenshot/);
  assert.match(message, /pre-loaded 2 skill\(s\)/);
  assert.match(message, /playwright-cli/);
  assert.match(message, /gstack-browse/);
  assert.match(message, /# Playwright/);
  assert.match(message, /# GStack/);
});

test("formatLoadedSkillsSummary lists all matches compactly", () => {
  const summary = formatLoadedSkillsSummary([
    {
      candidate: {
        skill: {
          name: "playwright-cli",
          description: "Browser automation, web scraping, screenshots",
          path: "/tmp/playwright-cli/SKILL.md",
          source: "/tmp/.pi/skills",
        },
        score: 1,
        why: "matched skill description",
      },
      content: "",
    },
  ]);

  assert.match(summary, /Pre-loaded 1 skill\(s\)/);
  assert.match(summary, /playwright-cli \(1\.00\)/);
});
