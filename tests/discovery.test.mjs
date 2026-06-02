import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discoverSkills } from "../src/discovery.js";

test("parses block scalar descriptions from SKILL frontmatter", async () => {
  const root = await mkdtemp(join(tmpdir(), "shiori-discovery-"));
  const skillDir = join(root, ".pi", "skills", "demo-skill");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    `---
name: demo-skill
description: |
  PROACTIVELY activate for browser scraping and screenshots.
  Triggers: "vault search", "browser"
---
# Demo
`,
    "utf8",
  );

  const skills = await discoverSkills(root);
  const skill = skills.find((record) => record.name === "demo-skill");

  assert.ok(skill);
  assert.match(skill.description, /browser scraping/);
  assert.notEqual(skill.description, "|");
});
