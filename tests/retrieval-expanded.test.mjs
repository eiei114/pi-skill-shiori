import assert from "node:assert/strict";
import test from "node:test";
import { retrieveCandidatesExpanded } from "../src/retrieval-expanded.js";

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
    name: "git-guardrails-claude-code",
    description: "Git safety hooks for auth and push protection",
    path: "/tmp/git-guardrails/SKILL.md",
    source: "/tmp/.pi/skills",
  },
  {
    name: "x-twitter-scraper",
    description: "Tweet search, timeline monitoring, follower export, and social media data collection",
    path: "/tmp/x-twitter-scraper/SKILL.md",
    source: "/tmp/.pi/skills",
  },
];

test("retrieveCandidatesExpanded finds browser skills from natural language", () => {
  const hits = retrieveCandidatesExpanded("browser scraping screenshot", skills, policy);
  assert.ok(hits.some((candidate) => candidate.skill.name === "playwright-cli"));
});

test("retrieveCandidatesExpanded expands Japanese auth queries", () => {
  const hits = retrieveCandidatesExpanded("認証まわりのスキルを探して", skills, policy);
  assert.ok(hits.length > 0);
});

test("retrieveCandidatesExpanded expands X API social data queries", () => {
  const hits = retrieveCandidatesExpanded("X API follower export", skills, policy);
  assert.ok(hits.some((candidate) => candidate.skill.name === "x-twitter-scraper"));
});

test("retrieveCandidatesExpanded ignores unrelated bare X prompts", () => {
  const hits = retrieveCandidatesExpanded("x coordinate transform", skills, policy);
  assert.ok(hits.every((candidate) => candidate.skill.name !== "x-twitter-scraper"));
});
