import assert from "node:assert/strict";
import test from "node:test";
import { compareCandidates, retrieveCandidates } from "../src/retrieval.js";

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

test("retrieveCandidates does not evict a trigger match behind a higher-scoring description match", () => {
  // Regression: this per-variant cap runs before expanded retrieval merges
  // variants, so a trigger match dropped here can never be restored downstream.
  const capPolicy = {
    zeroCatalog: { enabled: true },
    defaults: { activation: "explicit" },
    candidateInjection: { maxCandidates: 1, minScore: 0.62 },
    alwaysVisible: [],
    skills: {
      "auth-helper": {
        activation: "triggerable",
        triggers: { include: ["auth"], exclude: [] },
      },
    },
  };
  const capSkills = [
    {
      name: "auth-helper",
      description: "Handles sign-in",
      path: "/tmp/auth-helper/SKILL.md",
      source: "/tmp/.pi/skills",
    },
    {
      name: "plain-notes",
      description: "Auth notes and checklists",
      path: "/tmp/plain-notes/SKILL.md",
      source: "/tmp/.pi/skills",
    },
  ];

  const hits = retrieveCandidates("auth", capSkills, capPolicy);
  const trigger = hits.find((candidate) => candidate.skill.name === "auth-helper");
  assert.ok(trigger, "trigger match must survive the per-variant candidate cap");
  assert.equal(trigger?.reason, "trigger");
});

const candidate = (name, score, reason) => ({
  skill: { name, description: "", path: `/tmp/${name}/SKILL.md`, source: "/tmp/.pi/skills" },
  score,
  reason,
  why: "",
});

test("compareCandidates ranks trigger matches ahead of higher-scoring description matches", () => {
  const ordered = [
    candidate("aaa-description", 1, "description"),
    candidate("mmm-low", 0.7, "low-confidence"),
    candidate("zzz-trigger", 0.95, "trigger"),
  ].sort(compareCandidates);

  assert.deepEqual(
    ordered.map((entry) => entry.skill.name),
    ["zzz-trigger", "aaa-description", "mmm-low"],
  );
});

test("compareCandidates keeps score then name ordering within one reason", () => {
  const ordered = [
    candidate("beta", 0.9, "description"),
    candidate("gamma", 0.8, "description"),
    candidate("alpha", 0.9, "description"),
  ].sort(compareCandidates);

  assert.deepEqual(
    ordered.map((entry) => entry.skill.name),
    ["alpha", "beta", "gamma"],
  );
});
