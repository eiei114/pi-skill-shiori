import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  computeInventoryFingerprint,
  discoverSkills,
  discoverSkillsFromRoots,
  resolveVaultSkillRoots,
} from "../src/discovery.js";
import { loadPolicy } from "../src/policy.js";
import { isInventoryStale, refreshSkillInventory } from "../src/inventory.js";
import { retrieveCandidatesExpanded } from "../src/retrieval-expanded.js";

test("resolveVaultSkillRoots includes project, agents, and global roots", async () => {
  const cwd = await mkdtemp(join(homedir(), "shiori-vault-roots-"));
  const roots = resolveVaultSkillRoots(cwd);

  assert.ok(roots.some((root) => root.endsWith(join(".pi", "skills"))));
  assert.ok(roots.some((root) => root.endsWith(join(".agents", "skills"))));
  assert.ok(roots.some((root) => root.endsWith(join(".pi", "agent", "skills"))));
});

test("discoverSkills indexes skills from multiple vault-local roots with precedence", async () => {
  const root = await mkdtemp(join(homedir(), "shiori-vault-multi-"));
  const piSkillDir = join(root, ".pi", "skills", "pi-only");
  const agentsSkillDir = join(root, ".agents", "skills", "agents-only");
  const extraSkillDir = join(root, "custom-skills", "extra-only");

  for (const [dir, name, description] of [
    [piSkillDir, "pi-only", "Skill from .pi/skills"],
    [agentsSkillDir, "agents-only", "Skill from .agents/skills"],
    [extraSkillDir, "extra-only", "Skill from custom root"],
  ]) {
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`,
      "utf8",
    );
  }

  const policy = await loadPolicy(root);
  policy.inventory = { roots: ["custom-skills"] };
  const skills = await discoverSkills(root, policy);
  const names = skills.map((skill) => skill.name).sort();

  assert.deepEqual(names, ["agents-only", "extra-only", "pi-only"]);
  assert.equal(skills.find((skill) => skill.name === "pi-only")?.source, join(root, ".pi", "skills"));
  assert.equal(skills.find((skill) => skill.name === "agents-only")?.source, join(root, ".agents", "skills"));
  assert.equal(skills.find((skill) => skill.name === "extra-only")?.source, join(root, "custom-skills"));
});

test("refreshSkillInventory rebuilds after local skill changes", async () => {
  const root = await mkdtemp(join(homedir(), "shiori-vault-refresh-"));
  const skillDir = join(root, ".pi", "skills", "first-skill");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    "---\nname: first-skill\ndescription: Initial inventory\n---\n# First\n",
    "utf8",
  );

  const policy = await loadPolicy(root);
  const initial = await refreshSkillInventory(root, policy);
  assert.equal(initial.index.skills.length, 1);
  assert.equal(initial.index.skills[0]?.name, "first-skill");

  const secondDir = join(root, ".agents", "skills", "second-skill");
  await mkdir(secondDir, { recursive: true });
  await writeFile(
    join(secondDir, "SKILL.md"),
    "---\nname: second-skill\ndescription: Added after startup\n---\n# Second\n",
    "utf8",
  );

  assert.equal(await isInventoryStale(root, policy, initial.fingerprint), true);

  const refreshed = await refreshSkillInventory(root, policy, initial.index);
  const names = refreshed.index.skills.map((skill) => skill.name).sort();
  assert.deepEqual(names, ["first-skill", "second-skill"]);
  assert.notEqual(refreshed.fingerprint, initial.fingerprint);
});

test("refreshed inventory keeps policy-aware description-first retrieval", async () => {
  const root = await mkdtemp(join(homedir(), "shiori-vault-retrieval-"));
  const skillDir = join(root, ".pi", "skills", "vault-search");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    '---\nname: vault-search\ndescription: Search notes with qmd. Triggers: "vault search"\n---\n# Vault\n',
    "utf8",
  );
  await writeFile(
    join(root, ".pi", "skill-shiori.yml"),
    [
      "defaults:",
      "  activation: explicit",
      "candidateInjection:",
      "  maxCandidates: 3",
      "  minScore: 0.5",
      "skills:",
      "  vault-search:",
      "    activation: triggerable",
      "    triggers:",
      "      include:",
      "        - vault search",
      "",
    ].join("\n"),
    "utf8",
  );

  const policy = await loadPolicy(root);
  const { index } = await refreshSkillInventory(root, policy);
  const hits = retrieveCandidatesExpanded("vault search markdown", index.skills, policy, index);

  assert.ok(hits.some((candidate) => candidate.skill.name === "vault-search"));
  assert.match(hits[0]?.why ?? "", /trigger|description/i);
});

test("computeInventoryFingerprint changes when skill files change", async () => {
  const root = await mkdtemp(join(homedir(), "shiori-vault-fingerprint-"));
  const roots = resolveVaultSkillRoots(root);
  const skillDir = join(root, ".pi", "skills", "demo");
  await mkdir(skillDir, { recursive: true });

  const before = await computeInventoryFingerprint(roots);
  await writeFile(join(skillDir, "SKILL.md"), "---\nname: demo\ndescription: demo\n---\n", "utf8");
  const after = await computeInventoryFingerprint(roots);

  assert.notEqual(before, after);
});

test("discoverSkillsFromRoots deduplicates by discovery order", async () => {
  const root = await mkdtemp(join(homedir(), "shiori-vault-dedupe-"));
  const piDir = join(root, ".pi", "skills", "shared-name");
  const agentsDir = join(root, ".agents", "skills", "shared-name");
  for (const dir of [piDir, agentsDir]) {
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "SKILL.md"),
      "---\nname: shared-name\ndescription: duplicate\n---\n",
      "utf8",
    );
  }

  const skills = await discoverSkillsFromRoots(resolveVaultSkillRoots(root));
  assert.equal(skills.length, 1);
  assert.equal(skills[0]?.source, join(root, ".pi", "skills"));
});
