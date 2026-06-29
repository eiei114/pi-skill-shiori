import assert from "node:assert/strict";
import test from "node:test";
import {
  formatLoadedSkillsSummary,
  formatRecommendKickoffMessage,
  suppressSkillCatalog,
} from "../src/prompt.js";

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
        reason: "description",
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
        reason: "description",
      },
      content: "# GStack\n\nBrowse the web.",
    },
  ]);

  assert.match(message, /browser scraping screenshot/);
  assert.match(message, /pre-loaded 2 skill\(s\)/);
  assert.match(message, /playwright-cli \[description\]/);
  assert.match(message, /gstack-browse \[description\]/);
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
        reason: "description",
      },
      content: "",
    },
  ]);

  assert.match(summary, /Pre-loaded 1 skill\(s\)/);
  assert.match(summary, /playwright-cli \[description\] \(1\.00\)/);
});

function sampleXmlCatalog() {
  return [
    "",
    "",
    "The following skills provide specialized instructions for specific tasks.",
    "Use the read tool to load a skill's file when the task matches its description.",
    "",
    "<available_skills>",
    "  <skill>",
    "    <name>pi-skill-shiori</name>",
    "    <description>Skill selection layer</description>",
    "    <location>/tmp/pi-skill-shiori/SKILL.md</location>",
    "  </skill>",
    "  <skill>",
    "    <name>reddit-research</name>",
    "    <description>Research Reddit threads</description>",
    "    <location>/tmp/reddit-research/SKILL.md</location>",
    "  </skill>",
    "  <skill>",
    "    <name>safety-helper</name>",
    "    <description>Safety-critical helper</description>",
    "    <location>/tmp/safety-helper/SKILL.md</location>",
    "  </skill>",
    "</available_skills>",
  ].join("\n");
}

const inventory = [
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

test("suppressSkillCatalog keeps only always-visible skills in the XML catalog", () => {
  const result = suppressSkillCatalog(`System prompt prefix${sampleXmlCatalog()}`, {
    alwaysVisible: ["pi-skill-shiori", "safety-helper"],
    skills: inventory,
  });

  assert.equal(result.status, "suppressed");
  assert.match(result.systemPrompt, /<name>pi-skill-shiori<\/name>/);
  assert.match(result.systemPrompt, /<name>safety-helper<\/name>/);
  assert.doesNotMatch(result.systemPrompt, /<name>reddit-research<\/name>/);
});

test("suppressSkillCatalog hides the catalog when no always-visible skills resolve", () => {
  const result = suppressSkillCatalog(`System prompt prefix${sampleXmlCatalog()}`, {
    alwaysVisible: ["ghost-skill"],
    skills: inventory,
  });

  assert.equal(result.status, "suppressed");
  assert.match(result.systemPrompt, /Normal Skill Catalog hidden by Pi Skill Shiori/);
  assert.doesNotMatch(result.systemPrompt, /<available_skills>/);
});

test("suppressSkillCatalog filters markdown catalogs without widening hidden skills", () => {
  const catalog = [
    "",
    "### Available skills",
    "- **pi-skill-shiori**: Skill selection layer",
    "- **reddit-research**: Research Reddit threads",
    "",
    "### How to use skills",
    "Use /skill:name when needed.",
  ].join("\n");

  const result = suppressSkillCatalog(`Prefix${catalog}`, {
    alwaysVisible: ["pi-skill-shiori"],
    skills: inventory,
  });

  assert.equal(result.status, "suppressed");
  assert.match(result.systemPrompt, /\*\*pi-skill-shiori\*\*/);
  assert.doesNotMatch(result.systemPrompt, /reddit-research/);
});
