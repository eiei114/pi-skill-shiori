import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

/**
 * Create an isolated vault fixture under the OS temp directory and remove it
 * when the test finishes. Fixtures used to be created under `homedir()` with no
 * cleanup, so every test run left six `shiori-vault-*` directories in the user
 * home folder.
 */
async function vaultFixture(t, prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return dir;
}

test("resolveVaultSkillRoots includes project, agents, and global roots", async (t) => {
  const cwd = await vaultFixture(t, "shiori-vault-roots-");
  const roots = resolveVaultSkillRoots(cwd);

  assert.ok(roots.some((root) => root.endsWith(join(".pi", "skills"))));
  assert.ok(roots.some((root) => root.endsWith(join(".agents", "skills"))));
  assert.ok(roots.some((root) => root.endsWith(join(".pi", "agent", "skills"))));
});

test("discoverSkills indexes skills from multiple vault-local roots with precedence", async (t) => {
  const root = await vaultFixture(t, "shiori-vault-multi-");
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
  const names = skills.map((skill) => skill.name);

  // All test skills should be discovered (global root may contribute others).
  assert.ok(names.includes("agents-only"), "agents-only skill should be discovered");
  assert.ok(names.includes("extra-only"), "extra-only skill should be discovered");
  assert.ok(names.includes("pi-only"), "pi-only skill should be discovered");
  assert.equal(skills.find((skill) => skill.name === "pi-only")?.source, join(root, ".pi", "skills"));
  assert.equal(skills.find((skill) => skill.name === "agents-only")?.source, join(root, ".agents", "skills"));
  assert.equal(skills.find((skill) => skill.name === "extra-only")?.source, join(root, "custom-skills"));
});

test("refreshSkillInventory rebuilds after local skill changes", async (t) => {
  const root = await vaultFixture(t, "shiori-vault-refresh-");
  const skillDir = join(root, ".pi", "skills", "first-skill");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    "---\nname: first-skill\ndescription: Initial inventory\n---\n# First\n",
    "utf8",
  );

  const policy = await loadPolicy(root);
  const initial = await refreshSkillInventory(root, policy);
  assert.ok(initial.index.skills.some((skill) => skill.name === "first-skill"));

  const secondDir = join(root, ".agents", "skills", "second-skill");
  await mkdir(secondDir, { recursive: true });
  await writeFile(
    join(secondDir, "SKILL.md"),
    "---\nname: second-skill\ndescription: Added after startup\n---\n# Second\n",
    "utf8",
  );

  assert.equal(await isInventoryStale(root, policy, initial.fingerprint), true);

  const refreshed = await refreshSkillInventory(root, policy, initial.index);
  const names = refreshed.index.skills.map((skill) => skill.name);
  assert.ok(names.includes("first-skill"));
  assert.ok(names.includes("second-skill"));
  assert.notEqual(refreshed.fingerprint, initial.fingerprint);

  refreshed.index.close?.();
});

test("refreshed inventory keeps policy-aware description-first retrieval", async (t) => {
  const root = await vaultFixture(t, "shiori-vault-retrieval-");
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
      "  maxCandidates: 15",
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

  const vaultHit = hits.find((candidate) => candidate.skill.name === "vault-search");
  assert.ok(vaultHit, "vault-search should be in the hits");
  assert.match(vaultHit.why, /trigger|description/i);

  index.close?.();
});

test("computeInventoryFingerprint changes when skill files change", async (t) => {
  const root = await vaultFixture(t, "shiori-vault-fingerprint-");
  const roots = resolveVaultSkillRoots(root);
  const skillDir = join(root, ".pi", "skills", "demo");
  await mkdir(skillDir, { recursive: true });

  const before = await computeInventoryFingerprint(roots);
  await writeFile(join(skillDir, "SKILL.md"), "---\nname: demo\ndescription: demo\n---\n", "utf8");
  const after = await computeInventoryFingerprint(roots);

  assert.notEqual(before, after);
});

test("discoverSkillsFromRoots deduplicates by discovery order", async (t) => {
  const root = await vaultFixture(t, "shiori-vault-dedupe-");
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
  const deduped = skills.filter((s) => s.name === "shared-name");
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0]?.source, join(root, ".pi", "skills"));
});
