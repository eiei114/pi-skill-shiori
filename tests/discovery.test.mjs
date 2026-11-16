import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discoverSkills, parseSkillFrontmatter } from "../src/discovery.js";

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

const REFERENCE_SKILL = [
  "---",
  "name: bom-crlf-skill",
  "description: Windows-authored skill with a BOM or CRLF endings.",
  "---",
  "# BOM CRLF Skill",
  "",
  "Body paragraph used for the fallback description.",
  "",
].join("\n");

const BOM = "\uFEFF";

async function writeSkillFile(root, dirName, content) {
  const skillDir = join(root, ".pi", "skills", dirName);
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), content, "utf8");
  return join(skillDir, "SKILL.md");
}

async function discoverSingleSkill(root, dirName) {
  const skills = await discoverSkills(root);
  const skill = skills.find((record) => record.path === join(root, ".pi", "skills", dirName, "SKILL.md"));
  assert.ok(skill, `skill in ${dirName} should be discovered`);
  return skill;
}

function assertCleanText(value, label) {
  assert.equal(value.includes("\r"), false, `${label} must not contain a carriage return`);
  assert.equal(value.includes(BOM), false, `${label} must not contain a UTF-8 BOM`);
}

test("discovery parses a SKILL.md with a UTF-8 BOM and LF endings", async () => {
  const root = await mkdtemp(join(tmpdir(), "shiori-bom-lf-"));
  await writeSkillFile(root, "bom-lf", BOM + REFERENCE_SKILL);

  const skill = await discoverSingleSkill(root, "bom-lf");
  assert.equal(skill.name, "bom-crlf-skill");
  assert.equal(skill.description, "Windows-authored skill with a BOM or CRLF endings.");
  assertCleanText(skill.name, "name");
  assertCleanText(skill.description, "description");
});

test("discovery parses a SKILL.md with CRLF endings", async () => {
  const root = await mkdtemp(join(tmpdir(), "shiori-crlf-"));
  await writeSkillFile(root, "crlf", REFERENCE_SKILL.replace(/\n/g, "\r\n"));

  const skill = await discoverSingleSkill(root, "crlf");
  assert.equal(skill.name, "bom-crlf-skill");
  assert.equal(skill.description, "Windows-authored skill with a BOM or CRLF endings.");
  assertCleanText(skill.name, "name");
  assertCleanText(skill.description, "description");
});

test("discovery parses a SKILL.md with both a BOM and CRLF endings", async () => {
  const root = await mkdtemp(join(tmpdir(), "shiori-bom-crlf-"));
  await writeSkillFile(root, "bom-crlf", BOM + REFERENCE_SKILL.replace(/\n/g, "\r\n"));

  const skill = await discoverSingleSkill(root, "bom-crlf");
  assert.equal(skill.name, "bom-crlf-skill");
  assert.equal(skill.description, "Windows-authored skill with a BOM or CRLF endings.");
  assertCleanText(skill.name, "name");
  assertCleanText(skill.description, "description");
});

test("BOM/CRLF SKILL.md yields the same record as its LF no-BOM twin", async () => {
  const variants = [
    ["reference", REFERENCE_SKILL],
    ["bom-only", BOM + REFERENCE_SKILL],
    ["crlf-only", REFERENCE_SKILL.replace(/\n/g, "\r\n")],
    ["bom-crlf-both", BOM + REFERENCE_SKILL.replace(/\n/g, "\r\n")],
  ];

  const records = [];
  for (const [dirName, content] of variants) {
    // One root per variant: dedupeByDiscoveryOrder keeps one record per name.
    const root = await mkdtemp(join(tmpdir(), `shiori-bom-crlf-${dirName}-`));
    await writeSkillFile(root, "variant", content);
    const skill = await discoverSingleSkill(root, "variant");
    records.push([dirName, skill]);
  }

  const [, reference] = records[0];
  for (const [dirName, record] of records) {
    assert.equal(record.name, reference.name, `${dirName} name`);
    assert.equal(record.description, reference.description, `${dirName} description`);
    assertCleanText(record.name, `${dirName} name`);
    assertCleanText(record.description, `${dirName} description`);
  }
});

test("discovery falls back to the directory name and first paragraph without frontmatter", async () => {
  const root = await mkdtemp(join(tmpdir(), "shiori-no-frontmatter-"));
  await writeSkillFile(
    root,
    "plain-skill",
    BOM + ["# Plain Skill", "", "First paragraph of the body.", "", "Second paragraph.", ""].join("\r\n"),
  );

  const skill = await discoverSingleSkill(root, "plain-skill");
  assert.equal(skill.name, "plain-skill");
  assert.equal(skill.description, "# Plain Skill");
  assertCleanText(skill.name, "name");
  assertCleanText(skill.description, "description");
});

test("discovery falls back without throwing when frontmatter YAML is malformed", async () => {
  const root = await mkdtemp(join(tmpdir(), "shiori-malformed-frontmatter-"));
  await writeSkillFile(
    root,
    "malformed-skill",
    BOM +
      ["---", "name: [unterminated", "description: broken: [", "---", "# Malformed", "", "Body paragraph.", ""].join(
        "\r\n",
      ),
  );

  const skill = await discoverSingleSkill(root, "malformed-skill");
  assert.equal(skill.name, "malformed-skill");
  assert.equal(skill.description, "# Malformed");
  assertCleanText(skill.name, "name");
  assertCleanText(skill.description, "description");
});

test("parseSkillFrontmatter normalises BOM/CRLF and tolerates loose fences", () => {
  const parsed = parseSkillFrontmatter(
    BOM + "---   \r\nname: loose-fence\r\ndescription: Trailing spaces after the opening fence.\r\n---\t\r\n# Body\r\n",
  );

  assert.equal(parsed.name, "loose-fence");
  assert.equal(parsed.description, "Trailing spaces after the opening fence.");
  assert.equal(parsed.body, "# Body\n");
});

test("parseSkillFrontmatter accepts an empty frontmatter block", () => {
  const parsed = parseSkillFrontmatter("---\n---\n# Body\n\nParagraph.\n");

  assert.equal(parsed.name, undefined);
  assert.equal(parsed.description, undefined);
  assert.equal(parsed.body, "# Body\n\nParagraph.\n");
});
