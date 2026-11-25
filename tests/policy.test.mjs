import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_POLICY, loadPolicyWithSource, loadedPolicySignature } from "../src/policy.ts";

test("loadPolicyWithSource falls back to default when no policy exists", async () => {
  const { cwd, globalPolicyPath } = await makePolicyFixture();
  try {
    const loaded = await loadPolicyWithSource(cwd, { globalPolicyPath });

    assert.equal(loaded.source, "default");
    assert.equal(loaded.path, undefined);
    assert.equal(loaded.policy.zeroCatalog.enabled, false);
    assert.equal(loaded.warnings, undefined);
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
    assert.equal(loaded.warnings, undefined);
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

test("invalid maxCandidates falls back to the default and warns", async () => {
  const cases = [
    ["maxCandidates: -1", -1],
    ["maxCandidates: 1.5", 1.5],
    ['maxCandidates: "3"', "3"],
    ["maxCandidates: 11", 11],
  ];

  for (const [line, label] of cases) {
    const { cwd, globalPolicyPath } = await makePolicyFixture();
    try {
      await writeProjectPolicy(cwd, `candidateInjection:\n  ${line}\n`);

      const loaded = await loadPolicyWithSource(cwd, { globalPolicyPath });

      assert.equal(
        loaded.policy.candidateInjection.maxCandidates,
        DEFAULT_POLICY.candidateInjection.maxCandidates,
        `${label} should fall back to the default`,
      );
      assert.equal(loaded.warnings?.length, 1);
      assert.match(
        loaded.warnings[0],
        /^candidateInjection\.maxCandidates: expected an integer between 0 and 10, got .+; using 3$/,
      );
    } finally {
      await cleanup(cwd);
    }
  }
});

test("boundary maxCandidates values 0 and 10 are accepted unchanged", async () => {
  for (const value of [0, 10]) {
    const { cwd, globalPolicyPath } = await makePolicyFixture();
    try {
      await writeProjectPolicy(cwd, `candidateInjection:\n  maxCandidates: ${value}\n`);

      const loaded = await loadPolicyWithSource(cwd, { globalPolicyPath });

      assert.equal(loaded.policy.candidateInjection.maxCandidates, value);
      assert.equal(loaded.warnings, undefined);
    } finally {
      await cleanup(cwd);
    }
  }
});

test("invalid minScore falls back to the default and warns", async () => {
  const cases = [
    ['minScore: "high"', '"high"'],
    ["minScore: -0.5", "-0.5"],
    ["minScore: 1.5", "1.5"],
    ["minScore: .nan", ".nan"],
  ];

  for (const [line, label] of cases) {
    const { cwd, globalPolicyPath } = await makePolicyFixture();
    try {
      await writeProjectPolicy(cwd, `candidateInjection:\n  ${line}\n`);

      const loaded = await loadPolicyWithSource(cwd, { globalPolicyPath });

      assert.equal(
        loaded.policy.candidateInjection.minScore,
        DEFAULT_POLICY.candidateInjection.minScore,
        `${label} should fall back to the default`,
      );
      assert.equal(loaded.warnings?.length, 1);
      assert.match(
        loaded.warnings[0],
        /^candidateInjection\.minScore: expected a finite number between 0 and 1, got .+; using 0\.62$/,
      );
    } finally {
      await cleanup(cwd);
    }
  }
});

test("boundary minScore values 0 and 1 are accepted unchanged", async () => {
  for (const value of [0, 1]) {
    const { cwd, globalPolicyPath } = await makePolicyFixture();
    try {
      await writeProjectPolicy(cwd, `candidateInjection:\n  minScore: ${value}\n`);

      const loaded = await loadPolicyWithSource(cwd, { globalPolicyPath });

      assert.equal(loaded.policy.candidateInjection.minScore, value);
      assert.equal(loaded.warnings, undefined);
    } finally {
      await cleanup(cwd);
    }
  }
});

test("invalid defaults.activation falls back to explicit and warns", async () => {
  const { cwd, globalPolicyPath } = await makePolicyFixture();
  try {
    await writeProjectPolicy(cwd, "defaults:\n  activation: trigerable\n");

    const loaded = await loadPolicyWithSource(cwd, { globalPolicyPath });

    assert.equal(loaded.policy.defaults.activation, "explicit");
    assert.equal(loaded.warnings?.length, 1);
    assert.match(
      loaded.warnings[0],
      /^defaults\.activation: expected "explicit" or "triggerable", got "trigerable"; using "explicit"$/,
    );
  } finally {
    await cleanup(cwd);
  }
});

test("valid defaults.activation values are accepted unchanged", async () => {
  const { cwd, globalPolicyPath } = await makePolicyFixture();
  try {
    await writeProjectPolicy(cwd, "defaults:\n  activation: triggerable\n");

    const loaded = await loadPolicyWithSource(cwd, { globalPolicyPath });

    assert.equal(loaded.policy.defaults.activation, "triggerable");
    assert.equal(loaded.warnings, undefined);
  } finally {
    await cleanup(cwd);
  }
});

test("malformed policy sections warn once and use their defaults", async () => {
  const cases = [
    {
      yaml: "candidateInjection: [3, 0.5]\n",
      section: "candidateInjection",
      kind: "an array",
      assertDefault(policy) {
        assert.equal(policy.candidateInjection.maxCandidates, DEFAULT_POLICY.candidateInjection.maxCandidates);
        assert.equal(policy.candidateInjection.minScore, DEFAULT_POLICY.candidateInjection.minScore);
      },
    },
    {
      yaml: "defaults: triggerable\n",
      section: "defaults",
      kind: "a string",
      assertDefault(policy) {
        assert.equal(policy.defaults.activation, DEFAULT_POLICY.defaults.activation);
      },
    },
    {
      yaml: "zeroCatalog: []\n",
      section: "zeroCatalog",
      kind: "an array",
      assertDefault(policy) {
        assert.equal(policy.zeroCatalog.enabled, DEFAULT_POLICY.zeroCatalog.enabled);
      },
    },
    {
      yaml: "inventory: true\n",
      section: "inventory",
      kind: "a boolean",
      assertDefault(policy) {
        assert.equal(policy.inventory, undefined);
      },
    },
  ];

  for (const { yaml, section, kind, assertDefault } of cases) {
    const { cwd, globalPolicyPath } = await makePolicyFixture();
    try {
      await writeProjectPolicy(cwd, yaml);

      const loaded = await loadPolicyWithSource(cwd, { globalPolicyPath });

      assertDefault(loaded.policy);
      assert.deepEqual(loaded.warnings, [
        `${section}: expected a mapping, got ${kind}; using built-in defaults`,
      ]);
    } finally {
      await cleanup(cwd);
    }
  }
});

test("omitted policy sections do not warn", async () => {
  const { cwd, globalPolicyPath } = await makePolicyFixture();
  try {
    await writeProjectPolicy(cwd, "alwaysVisible: []\n");

    const loaded = await loadPolicyWithSource(cwd, { globalPolicyPath });

    assert.equal(loaded.warnings, undefined);
  } finally {
    await cleanup(cwd);
  }
});

test("invalid per-skill activation is dropped and warns", async () => {
  const { cwd, globalPolicyPath } = await makePolicyFixture();
  try {
    await writeProjectPolicy(
      cwd,
      [
        "skills:",
        "  auth-helper:",
        "    activation: trigerable",
        "  deploy-kit:",
        "    activation: triggerable",
        "",
      ].join("\n"),
    );

    const loaded = await loadPolicyWithSource(cwd, { globalPolicyPath });

    // The invalid value is dropped so `defaults.activation` applies instead.
    assert.equal(loaded.policy.skills["auth-helper"]?.activation, undefined);
    assert.deepEqual(loaded.policy.skills["auth-helper"], {});
    assert.equal(loaded.policy.skills["deploy-kit"]?.activation, "triggerable");
    assert.equal(loaded.warnings?.length, 1);
    assert.match(
      loaded.warnings[0],
      /^skills\.auth-helper\.activation: expected "explicit" or "triggerable", got "trigerable"; ignored so defaults\.activation applies$/,
    );
  } finally {
    await cleanup(cwd);
  }
});

test("skill triggers written as a string are dropped instead of crashing retrieval", async () => {
  const cases = [
    {
      yaml: [
        "skills:",
        "  auth-helper:",
        "    activation: triggerable",
        "    triggers:",
        "      include: auth",
        "",
      ].join("\n"),
      expected: { activation: "triggerable" },
      warning:
        /^skills\.auth-helper\.triggers\.include: expected a list of strings, got a string; dropped$/,
    },
    {
      yaml: [
        "skills:",
        "  auth-helper:",
        "    activation: triggerable",
        "    triggers:",
        "      include: auth",
        "      exclude:",
        "        - logout",
        "",
      ].join("\n"),
      expected: { activation: "triggerable", triggers: { exclude: ["logout"] } },
      warning:
        /^skills\.auth-helper\.triggers\.include: expected a list of strings, got a string; dropped$/,
    },
    {
      yaml: [
        "skills:",
        "  auth-helper:",
        "    triggers:",
        "      exclude: logout",
        "",
      ].join("\n"),
      expected: {},
      warning:
        /^skills\.auth-helper\.triggers\.exclude: expected a list of strings, got a string; dropped$/,
    },
    {
      yaml: [
        "skills:",
        "  auth-helper:",
        "    triggers: auth",
        "",
      ].join("\n"),
      expected: {},
      warning: /^skills\.auth-helper\.triggers: expected a mapping, got a string; dropped$/,
    },
  ];

  for (const { yaml, expected, warning } of cases) {
    const { cwd, globalPolicyPath } = await makePolicyFixture();
    try {
      await writeProjectPolicy(cwd, yaml);

      const loaded = await loadPolicyWithSource(cwd, { globalPolicyPath });

      assert.deepEqual(loaded.policy.skills["auth-helper"], expected);
      assert.equal(loaded.warnings?.length, 1);
      assert.match(loaded.warnings[0], warning);
    } finally {
      await cleanup(cwd);
    }
  }
});

test("non-string trigger entries are dropped and warn once", async () => {
  const { cwd, globalPolicyPath } = await makePolicyFixture();
  try {
    await writeProjectPolicy(
      cwd,
      [
        "skills:",
        "  auth-helper:",
        "    triggers:",
        "      include:",
        "        - auth",
        "        - 42",
        "",
      ].join("\n"),
    );

    const loaded = await loadPolicyWithSource(cwd, { globalPolicyPath });

    assert.deepEqual(loaded.policy.skills["auth-helper"]?.triggers, { include: ["auth"] });
    assert.deepEqual(loaded.warnings, [
      "skills.auth-helper.triggers.include: expected a list of strings, dropped 1 non-string entry",
    ]);
  } finally {
    await cleanup(cwd);
  }
});

test("valid trigger lists are accepted unchanged", async () => {
  const { cwd, globalPolicyPath } = await makePolicyFixture();
  try {
    await writeProjectPolicy(
      cwd,
      [
        "skills:",
        "  auth-helper:",
        "    activation: triggerable",
        "    triggers:",
        "      include:",
        "        - auth",
        "        - login",
        "      exclude:",
        "        - logout",
        "",
      ].join("\n"),
    );

    const loaded = await loadPolicyWithSource(cwd, { globalPolicyPath });

    assert.deepEqual(loaded.policy.skills["auth-helper"], {
      activation: "triggerable",
      triggers: { include: ["auth", "login"], exclude: ["logout"] },
    });
    assert.equal(loaded.warnings, undefined);
  } finally {
    await cleanup(cwd);
  }
});

test("a wrongly shaped alwaysVisible list falls back to the default allowlist and warns", async () => {
  const cases = [
    ["alwaysVisible: auth-helper\n", "a string"],
    ["alwaysVisible: 7\n", "a number"],
    ["alwaysVisible: {name: auth-helper}\n", "a mapping"],
  ];

  for (const [yaml, kind] of cases) {
    const { cwd, globalPolicyPath } = await makePolicyFixture();
    try {
      await writeProjectPolicy(cwd, yaml);

      const loaded = await loadPolicyWithSource(cwd, { globalPolicyPath });

      assert.deepEqual(loaded.policy.alwaysVisible, DEFAULT_POLICY.alwaysVisible);
      assert.equal(loaded.warnings?.length, 1);
      assert.match(
        loaded.warnings[0],
        new RegExp(`^alwaysVisible: expected a list of strings, got ${kind}; dropped$`),
      );
    } finally {
      await cleanup(cwd);
    }
  }
});

for (const { name, yaml, normalized, warnings } of [
  {
    name: "quoted false",
    yaml: 'inventory:\n  autoRefreshOnChange: "false"\n',
    normalized: undefined,
    warnings: ['inventory.autoRefreshOnChange: expected a YAML boolean, got "false"; auto-refresh remains enabled by default'],
  },
  {
    name: "literal false",
    yaml: "inventory:\n  autoRefreshOnChange: false\n",
    normalized: false,
    warnings: undefined,
  },
  {
    name: "omitted setting",
    yaml: "inventory: {}\n",
    normalized: undefined,
    warnings: undefined,
  },
]) {
  test(`inventory.autoRefreshOnChange policy handles ${name}`, async () => {
    const { cwd, globalPolicyPath } = await makePolicyFixture();
    try {
      await writeProjectPolicy(cwd, yaml);

      const loaded = await loadPolicyWithSource(cwd, { globalPolicyPath });

      assert.equal(loaded.policy.inventory?.autoRefreshOnChange, normalized);
      assert.deepEqual(loaded.warnings, warnings);
    } finally {
      await cleanup(cwd);
    }
  });
}

test("a wrongly shaped inventory.roots list is ignored and warns", async () => {
  const cases = [
    ['inventory:\n  roots: "./extra"\n', "a string"],
    ["inventory:\n  roots: 42\n", "a number"],
  ];

  for (const [yaml, kind] of cases) {
    const { cwd, globalPolicyPath } = await makePolicyFixture();
    try {
      await writeProjectPolicy(cwd, yaml);

      const loaded = await loadPolicyWithSource(cwd, { globalPolicyPath });

      assert.equal(loaded.policy.inventory, undefined);
      assert.equal(loaded.warnings?.length, 1);
      assert.match(
        loaded.warnings[0],
        new RegExp(`^inventory\\.roots: expected a list of strings, got ${kind}; dropped$`),
      );
    } finally {
      await cleanup(cwd);
    }
  }
});

test("skills as an array or scalar is rejected and warns", async () => {
  const cases = [
    ["skills:\n  - auth-helper\n", "an array"],
    ['skills: "auth-helper"\n', "a string"],
    ["skills: 42\n", "a number"],
  ];

  for (const [yaml, kind] of cases) {
    const { cwd, globalPolicyPath } = await makePolicyFixture();
    try {
      await writeProjectPolicy(cwd, yaml);

      const loaded = await loadPolicyWithSource(cwd, { globalPolicyPath });

      assert.deepEqual(loaded.policy.skills, {});
      assert.equal(loaded.warnings?.length, 1);
      assert.match(
        loaded.warnings[0],
        new RegExp(`^skills: expected a mapping of skill names to skill policies, got ${kind}; using no skills$`),
      );
    } finally {
      await cleanup(cwd);
    }
  }
});

test("non-mapping skill entries are dropped and warn", async () => {
  const { cwd, globalPolicyPath } = await makePolicyFixture();
  try {
    await writeProjectPolicy(
      cwd,
      [
        "skills:",
        "  auth-helper:",
        "    activation: triggerable",
        "  broken-skill:",
        "    - not-a-policy",
        "",
      ].join("\n"),
    );

    const loaded = await loadPolicyWithSource(cwd, { globalPolicyPath });

    assert.deepEqual(loaded.policy.skills, { "auth-helper": { activation: "triggerable" } });
    assert.equal(loaded.warnings?.length, 1);
    assert.match(
      loaded.warnings[0],
      /^skills\.broken-skill: expected a mapping, got an array; dropped$/,
    );
  } finally {
    await cleanup(cwd);
  }
});

test("an empty or scalar YAML document warns instead of silently defaulting", async () => {
  const cases = [["", "null"], ['"just a string"', "a string"]];

  for (const [yaml, kind] of cases) {
    const { cwd, globalPolicyPath } = await makePolicyFixture();
    try {
      await writeProjectPolicy(cwd, yaml);

      const loaded = await loadPolicyWithSource(cwd, { globalPolicyPath });

      assert.equal(loaded.source, "project");
      assert.deepEqual(loaded.policy.candidateInjection, DEFAULT_POLICY.candidateInjection);
      assert.equal(loaded.warnings?.length, 1);
      assert.match(
        loaded.warnings[0],
        new RegExp(
          `^policy: expected a mapping at the document root, got ${kind}; using built-in defaults$`,
        ),
      );
    } finally {
      await cleanup(cwd);
    }
  }
});

test("a YAML syntax error names the policy file path", async () => {
  const { cwd, globalPolicyPath } = await makePolicyFixture();
  const policyPath = join(cwd, ".pi", "skill-shiori.yml");
  try {
    await writeProjectPolicy(cwd, "zeroCatalog:\n  enabled: [true\n");

    await assert.rejects(
      () => loadPolicyWithSource(cwd, { globalPolicyPath }),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Failed to parse Shiori policy file/);
        assert.ok(
          error.message.includes(policyPath),
          `message should include ${policyPath}: ${error.message}`,
        );
        return true;
      },
    );
  } finally {
    await cleanup(cwd);
  }
});

test("loadedPolicySignature ignores rejected values and follows the effective policy", async () => {
  const { cwd, globalPolicyPath } = await makePolicyFixture();
  try {
    await writeProjectPolicy(cwd, "candidateInjection:\n  maxCandidates: -1\n");
    const clamped = await loadPolicyWithSource(cwd, { globalPolicyPath });

    await writeProjectPolicy(cwd, 'candidateInjection:\n  maxCandidates: "3"\n');
    const alsoClamped = await loadPolicyWithSource(cwd, { globalPolicyPath });

    // Different raw values, same clamped policy: the signature stays stable.
    assert.notDeepEqual(clamped.warnings, alsoClamped.warnings);
    assert.equal(loadedPolicySignature(clamped), loadedPolicySignature(alsoClamped));

    await writeProjectPolicy(cwd, "candidateInjection:\n  maxCandidates: 5\n");
    const changed = await loadPolicyWithSource(cwd, { globalPolicyPath });

    assert.equal(changed.policy.candidateInjection.maxCandidates, 5);
    assert.notEqual(loadedPolicySignature(clamped), loadedPolicySignature(changed));
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

async function writeProjectPolicy(cwd, yaml) {
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await writeFile(join(cwd, ".pi", "skill-shiori.yml"), yaml, "utf8");
}

async function cleanup(cwd) {
  await rm(cwd, { recursive: true, force: true });
}
