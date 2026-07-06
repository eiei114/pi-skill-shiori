import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadPolicyWithSource } from "../src/policy.ts";

test("loadPolicyWithSource falls back to default when no policy exists", async () => {
  const { cwd, globalPolicyPath } = await makePolicyFixture();
  try {
    const loaded = await loadPolicyWithSource(cwd, { globalPolicyPath });

    assert.equal(loaded.source, "default");
    assert.equal(loaded.path, undefined);
    assert.equal(loaded.policy.zeroCatalog.enabled, false);
  } finally {
    await cleanup(cwd);
  }
});

test("loadPolicyWithSource uses user-global policy when project policy is absent", async () => {
  const { cwd, globalPolicyPath } = await makePolicyFixture();
  try {
    await mkdir(join(cwd, "global"), { recursive: true });
    await writeFile(globalPolicyPath, "zeroCatalog:\n  enabled: true\nalwaysVisible: []\n", "utf8");

    const loaded = await loadPolicyWithSource(cwd, { globalPolicyPath });

    assert.equal(loaded.source, "global");
    assert.equal(loaded.path, globalPolicyPath);
    assert.equal(loaded.policy.zeroCatalog.enabled, true);
    assert.deepEqual(loaded.policy.alwaysVisible, []);
  } finally {
    await cleanup(cwd);
  }
});

test("loadPolicyWithSource prefers project policy over user-global policy", async () => {
  const { cwd, globalPolicyPath } = await makePolicyFixture();
  try {
    await mkdir(join(cwd, "global"), { recursive: true });
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(globalPolicyPath, "zeroCatalog:\n  enabled: true\n", "utf8");
    await writeFile(join(cwd, ".pi", "skill-shiori.yml"), "zeroCatalog:\n  enabled: false\n", "utf8");

    const loaded = await loadPolicyWithSource(cwd, { globalPolicyPath });

    assert.equal(loaded.source, "project");
    assert.equal(loaded.path, join(cwd, ".pi", "skill-shiori.yml"));
    assert.equal(loaded.policy.zeroCatalog.enabled, false);
  } finally {
    await cleanup(cwd);
  }
});

test("loadPolicyWithSource throws non-missing project policy read errors", async () => {
  const { cwd, globalPolicyPath } = await makePolicyFixture();
  try {
    await mkdir(join(cwd, ".pi", "skill-shiori.yml"), { recursive: true });

    await assert.rejects(
      () => loadPolicyWithSource(cwd, { globalPolicyPath }),
      (error) => error && error.code !== "ENOENT",
    );
  } finally {
    await cleanup(cwd);
  }
});

async function makePolicyFixture() {
  const cwd = await mkdtemp(join(tmpdir(), "shiori-policy-test-"));
  return {
    cwd,
    globalPolicyPath: join(cwd, "global", "skill-shiori.yml"),
  };
}

async function cleanup(cwd) {
  await rm(cwd, { recursive: true, force: true });
}
