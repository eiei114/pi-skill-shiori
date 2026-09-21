import assert from "node:assert/strict";
import test from "node:test";
import { retrieveCandidatesExpanded } from "../src/retrieval-expanded.js";

const policy = {
  zeroCatalog: { enabled: true },
  defaults: { activation: "explicit" },
  candidateInjection: { maxCandidates: 3, minScore: 0.62 },
  alwaysVisible: ["pi-skill-shiori"],
  skills: {
    "playwright-cli": {
      activation: "triggerable",
      triggers: { include: ["browser", "screenshot"], exclude: [] },
    },
    "auth-helper": {
      activation: "triggerable",
      triggers: { include: ["auth"], exclude: [] },
    },
  },
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
  {
    name: "auth-helper",
    description: "Helps with auth login flows",
    path: "/tmp/auth-helper/SKILL.md",
    source: "/tmp/.pi/skills",
  },
];

test("retrieveCandidatesExpanded finds browser skills from natural language", () => {
  const hits = retrieveCandidatesExpanded("browser scraping screenshot", skills, policy);
  const playwright = hits.find((candidate) => candidate.skill.name === "playwright-cli");
  assert.ok(playwright);
  assert.equal(playwright?.reason, "trigger");
});

test("retrieveCandidatesExpanded keeps trigger badges when expanded variants score higher on description", () => {
  const hits = retrieveCandidatesExpanded("auth login", skills, policy);
  const auth = hits.find((candidate) => candidate.skill.name === "auth-helper");
  assert.ok(auth);
  assert.equal(auth?.reason, "trigger");
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

test("retrieveCandidatesExpanded does not evict a trigger match behind single-token noise", () => {
  // Regression: a curated trigger match is scored at a fixed 0.95, while
  // description matches can reach 1.00 from derived single-token query variants
  // ("my" in "Curate my snippets"). Sorting by score alone let that noise push
  // the trigger match past the candidate cap, where it was dropped without a
  // trace.
  const noisePolicy = {
    zeroCatalog: { enabled: true },
    defaults: { activation: "explicit" },
    candidateInjection: { maxCandidates: 3, minScore: 0.62 },
    alwaysVisible: [],
    skills: {
      "memory-doctor": {
        activation: "triggerable",
        triggers: { include: ["memory is wrong"], exclude: [] },
      },
    },
  };

  // Skill names avoid every query token, so the only noise source is a
  // description matching one derived single-token variant.
  const noiseSkills = [
    {
      name: "memory-doctor",
      description: "Diagnose memory quality issues",
      path: "/tmp/memory-doctor/SKILL.md",
      source: "/tmp/.pi/skills",
    },
    {
      name: "alpha",
      description: "Review wrong outputs",
      path: "/tmp/alpha/SKILL.md",
      source: "/tmp/.pi/skills",
    },
    {
      name: "beta",
      description: "Recover forgotten sessions",
      path: "/tmp/beta/SKILL.md",
      source: "/tmp/.pi/skills",
    },
    {
      name: "gamma",
      description: "Curate my snippets",
      path: "/tmp/gamma/SKILL.md",
      source: "/tmp/.pi/skills",
    },
    {
      name: "delta",
      description: "Set preferences safely",
      path: "/tmp/delta/SKILL.md",
      source: "/tmp/.pi/skills",
    },
  ];
  const query = "memory is wrong, it forgot my preferences";

  // Precondition: uncapped, the noise genuinely outranks the trigger match.
  // Without this the test could pass vacuously if scoring ever changes.
  const uncapped = retrieveCandidatesExpanded(query, noiseSkills, {
    ...noisePolicy,
    candidateInjection: { ...noisePolicy.candidateInjection, maxCandidates: 99 },
  });
  const triggerScore = uncapped.find((candidate) => candidate.skill.name === "memory-doctor")?.score ?? 0;
  const outranking = uncapped.filter(
    (candidate) => candidate.reason !== "trigger" && candidate.score > triggerScore,
  );
  assert.ok(
    outranking.length >= noisePolicy.candidateInjection.maxCandidates,
    `fixture must yield at least ${noisePolicy.candidateInjection.maxCandidates} outranking noise candidates, got ${outranking.length}`,
  );

  const hits = retrieveCandidatesExpanded(query, noiseSkills, noisePolicy);
  const doctor = hits.find((candidate) => candidate.skill.name === "memory-doctor");
  assert.ok(doctor, "trigger-matched skill must not be evicted by the candidate cap");
  assert.equal(doctor?.reason, "trigger");
});

test("retrieveCandidatesExpanded applies the original query's exclude across derived variants", () => {
  // Excludes are evaluated per variant inside retrieveCandidates, so the derived
  // single-token variant "auth" loses the context of "do not use auth" and the
  // excluded skill leaks back into the merged set.
  const excludePolicy = {
    zeroCatalog: { enabled: true },
    defaults: { activation: "explicit" },
    candidateInjection: { maxCandidates: 3, minScore: 0.62 },
    alwaysVisible: [],
    skills: {
      "auth-helper": {
        activation: "triggerable",
        triggers: { include: ["auth"], exclude: ["do not use auth"] },
      },
    },
  };
  const excludeSkills = [
    {
      name: "auth-helper",
      description: "Helps with auth login flows",
      path: "/tmp/auth-helper/SKILL.md",
      source: "/tmp/.pi/skills",
    },
  ];

  const hits = retrieveCandidatesExpanded("do not use auth", excludeSkills, excludePolicy);
  assert.equal(hits.length, 0, "excluded skill must not be reintroduced by a derived variant");
});

test("retrieveCandidatesExpanded fills the cap with trigger matches when triggers exceed it", () => {
  const manyPolicy = {
    zeroCatalog: { enabled: true },
    defaults: { activation: "explicit" },
    candidateInjection: { maxCandidates: 2, minScore: 0.62 },
    alwaysVisible: [],
    skills: {
      "trig-a": { activation: "triggerable", triggers: { include: ["widget"], exclude: [] } },
      "trig-b": { activation: "triggerable", triggers: { include: ["widget"], exclude: [] } },
      "trig-c": { activation: "triggerable", triggers: { include: ["widget"], exclude: [] } },
    },
  };
  const manySkills = ["trig-a", "trig-b", "trig-c"].map((name) => ({
    name,
    description: "Widget handling",
    path: `/tmp/${name}/SKILL.md`,
    source: "/tmp/.pi/skills",
  }));

  const hits = retrieveCandidatesExpanded("widget", manySkills, manyPolicy);
  assert.equal(hits.length, 2);
  assert.ok(hits.every((candidate) => candidate.reason === "trigger"));
  // All trigger matches share score 0.95, so name ordering breaks the tie.
  assert.deepEqual(hits.map((candidate) => candidate.skill.name), ["trig-a", "trig-b"]);
});
