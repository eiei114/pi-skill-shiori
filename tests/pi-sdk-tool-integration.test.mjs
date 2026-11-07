import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

const root = resolve(import.meta.dirname, "..");
const extensionPath = resolve(root, "src/index.ts");
const skillName = "tool-smoke-skill";

function createFixture() {
  const base = mkdtempSync(resolve(tmpdir(), "shiori-pi-tool-"));
  const agentDir = resolve(base, "agent");
  const vaultDir = resolve(base, "vault");
  const skillDirectory = resolve(vaultDir, ".pi/skills", skillName);
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(skillDirectory, { recursive: true });
  writeFileSync(resolve(skillDirectory, "SKILL.md"), [
    "---",
    `name: ${skillName}`,
    "description: Deterministic Pi SDK tool compatibility fixture",
    "---",
    "# Tool Smoke Skill",
    "Body loaded through a Pi-mediated Shiori tool call.",
    "",
  ].join("\n"), "utf8");
  writeFileSync(resolve(vaultDir, ".pi/skill-shiori.yml"), [
    "defaults:",
    "  activation: explicit",
    "candidateInjection:",
    "  maxCandidates: 3",
    "  minScore: 0.5",
    "skills:",
    `  ${skillName}:`,
    "    activation: triggerable",
    "    triggers:",
    "      include:",
    "        - pi sdk tool compatibility",
    "",
  ].join("\n"), "utf8");
  return { base, agentDir, vaultDir };
}

async function runToolCalls(calls) {
  const fixture = createFixture();
  const faux = fauxProvider({ provider: "shiori-faux" });
  faux.setResponses([
    fauxAssistantMessage(calls.map(({ name, args, id }) => fauxToolCall(name, args, { id })), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);
  const resourceLoader = new DefaultResourceLoader({
    cwd: fixture.vaultDir,
    agentDir: fixture.agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    additionalExtensionPaths: [extensionPath],
    extensionFactories: [(pi) => { pi.registerProvider(faux.provider); }],
  });
  await resourceLoader.reload();
  const modelRuntime = await ModelRuntime.create({
    authPath: resolve(fixture.agentDir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  const { session, extensionsResult } = await createAgentSession({
    cwd: fixture.vaultDir,
    agentDir: fixture.agentDir,
    modelRuntime,
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory(),
    noTools: "builtin",
  });
  try {
    assert.deepEqual(extensionsResult.errors, []);
    await session.bindExtensions({});
    await session.setModel(faux.getModel());
    const results = [];
    session.subscribe((event) => {
      if (event.type === "tool_execution_end") results.push(event);
    });
    await session.prompt("Use Shiori tools for the pi sdk tool compatibility fixture.");
    return { results, calls: faux.state.callCount };
  } finally {
    // Release the extension's session-scoped index before removing the fixture (Windows file locks).
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    session.dispose();
    rmSync(fixture.base, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

test("Pi validates and executes Shiori TypeBox tools through the actual SDK host", async () => {
  const { results, calls } = await runToolCalls([
    { id: "recommend-1", name: "shiori_recommend", args: { task: "pi sdk tool compatibility" } },
    { id: "load-1", name: "shiori_load_skill", args: { skill: skillName } },
  ]);
  assert.equal(calls, 2);
  const byId = Object.fromEntries(results.map((event) => [event.toolCallId, event]));

  const recommend = byId["recommend-1"];
  assert.ok(recommend, "shiori_recommend executed");
  assert.equal(recommend.isError, false);
  assert.equal(recommend.result.details.query, "pi sdk tool compatibility");
  assert.ok(recommend.result.details.matches.some((match) => match.startsWith(skillName)));
  assert.match(recommend.result.content.map((block) => block.text).join("\n"), /Body loaded through a Pi-mediated Shiori tool call/);

  const load = byId["load-1"];
  assert.ok(load, "shiori_load_skill executed");
  assert.equal(load.isError, false);
  assert.equal(load.result.details.skill, skillName);
  assert.match(load.result.content[0].text, /Body loaded through a Pi-mediated Shiori tool call/);
});

test("Pi rejects missing required Shiori tool arguments before execution", async () => {
  const { results } = await runToolCalls([
    { id: "missing-recommend", name: "shiori_recommend", args: {} },
    { id: "missing-load", name: "shiori_load_skill", args: { name: skillName } },
  ]);
  for (const id of ["missing-recommend", "missing-load"]) {
    const event = results.find((entry) => entry.toolCallId === id);
    assert.ok(event, `${id} produced a tool result`);
    assert.equal(event.isError, true);
    assert.match(event.result.content.map((block) => block.text).join("\n"), /validat|required|must have/i);
  }
});
