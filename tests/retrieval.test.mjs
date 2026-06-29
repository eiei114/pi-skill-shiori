import assert from "node:assert/strict";
import test from "node:test";
import { retrieveCandidates } from "../src/retrieval.js";

const policy = {
  zeroCatalog: { enabled: true },
  defaults: { activation: "explicit" },
  candidateInjection: { maxCandidates: 3, minScore: 0.62 },
  alwaysVisible: ["pi-skill-shiori"],
  skills: {},
};

const skills = [
  {
    name: "playwright-cli",
    description: "Browser automation, web scraping, screenshots, browser, scrape, screenshot",
    path: "/tmp/playwright-cli/SKILL.md",
    source: "/tmp/.pi/skills",
  },
  {
    name: "obsidian-qmd",
    description: 'Search notes with qmd. Triggers: "vault search", "markdown search"',
    path: "/tmp/obsidian-qmd/SKILL.md",
    source: "/tmp/.pi/skills",
  },
];

test("retrieveCandidates scores all skills when fts returns no matches", () => {
  const index = {
    search() {
      return [];
    },
  };

  const hits = retrieveCandidates("browser scraping screenshot", skills, policy, index);
  const hit = hits.find((candidate) => candidate.skill.name === "playwright-cli");
  assert.ok(hit);
  assert.equal(hit?.reason, "description");
});

test("retrieveCandidates assigns trigger reason badges from policy triggers", () => {
  const triggerPolicy = {
    ...policy,
    skills: {
      "playwright-cli": {
        activation: "triggerable",
        triggers: { include: ["browser"], exclude: [] },
      },
    },
  };
  const index = { search() { return []; } };
  const hits = retrieveCandidates("browser scraping screenshot", skills, triggerPolicy, index);
  const hit = hits.find((candidate) => candidate.skill.name === "playwright-cli");
  assert.equal(hit?.reason, "trigger");
});

test("retrieveCandidates finds vault search skills from description tokens", () => {
  const index = {
    search() {
      return [];
    },
  };

  const hits = retrieveCandidates("vault search markdown", skills, policy, index);
  const hit = hits.find((candidate) => candidate.skill.name === "obsidian-qmd");
  assert.ok(hit);
  assert.ok(hit?.reason === "description" || hit?.reason === "low-confidence");
});
