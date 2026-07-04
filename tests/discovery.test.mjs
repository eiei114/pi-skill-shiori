import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
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

test("discoverSkills resolves skills through symlinked directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "shiori-symlink-"));
  const targetsDir = join(root, ".agents", "skills");
  await mkdir(targetsDir, { recursive: true });

  // Create actual skill directory outside the vault root
  const realDir = join(root, "external", "symlinked-skill");
  await mkdir(realDir, { recursive: true });
  await writeFile(
    join(realDir, "SKILL.md"),
    '---\nname: symlinked-skill\ndescription: Found via symlink\n---\n# Symlinked\n',
    "utf8",
  );

  // Create a symlink inside .agents/skills pointing to the external directory
  await symlink(realDir, join(targetsDir, "symlinked-skill"));

  const skills = await discoverSkills(root);
  const found = skills.find((record) => record.name === "symlinked-skill");

  assert.ok(found, "Skill under a symlinked directory should be discovered");
  assert.match(found.description, /symlink/i);
  assert.equal(found.source, join(root, ".agents", "skills"));
});

test("discoverSkills skips recursive symlink cycles", async () => {
  const root = await mkdtemp(join(tmpdir(), "shiori-symlink-cycle-"));
  const skillsRoot = join(root, ".pi", "skills");
  const skillDir = join(skillsRoot, "cycle-safe");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    '---\nname: cycle-safe\ndescription: Cycle guard fixture\n---\n# Cycle Safe\n',
    "utf8",
  );

  await symlink(skillsRoot, join(skillDir, "loop"));

  const skills = await discoverSkills(root);
  const matches = skills.filter((record) => record.name === "cycle-safe");

  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.path, join(skillDir, "SKILL.md"));
});
