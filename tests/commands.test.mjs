import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import piSkillShiori from "../src/index.ts";

const RELOAD_INVENTORY_ONLY = "Shiori inventory only";
const RELOAD_WITH_RUNTIME = "Shiori inventory + Pi runtime resources";
const RECOMMEND_QUEUE_TASK = "Pre-load matches and queue task for agent";
const RECOMMEND_REVIEW_ONLY = "Review recommendations only";

test("shiori:reload uses UI selection instead of --runtime args", async () => {
  const cwd = await makeSkillProject();
  const { commands, events } = registerExtension();
  try {
    const ctx = makeCommandContext(cwd, { selects: [RELOAD_INVENTORY_ONLY] });

    await commands.get("shiori:reload").handler("--runtime", ctx);

    assert.equal(ctx.reloadCount, 0);
    assert.match(ctx.notifications.at(-1).message, /Pi Skill Shiori reloaded:/);
  } finally {
    await cleanup(cwd, events);
  }
});

test("shiori:reload can reload runtime from UI selection", async () => {
  const cwd = await makeSkillProject();
  const { commands, events } = registerExtension();
  try {
    const ctx = makeCommandContext(cwd, { selects: [RELOAD_WITH_RUNTIME] });

    await commands.get("shiori:reload").handler("", ctx);

    assert.equal(ctx.reloadCount, 1);
    assert.equal(ctx.notifications.length, 0);
  } finally {
    await cleanup(cwd, events);
  }
});

test("shiori:recommend reads query from UI input and queues the recommendation flow", async () => {
  const cwd = await makeSkillProject();
  const { commands, events, sentUserMessages } = registerExtension();
  try {
    const ctx = makeCommandContext(cwd, {
      inputs: ["auth login"],
      selects: [RECOMMEND_QUEUE_TASK],
    });

    await commands.get("shiori:recommend").handler("ignored positional text", ctx);

    assert.equal(sentUserMessages.length, 1);
    assert.match(sentUserMessages[0], /^auth login\n/);
    assert.match(sentUserMessages[0], /auth-helper/);
    assert.doesNotMatch(sentUserMessages[0], /ignored positional text/);
  } finally {
    await cleanup(cwd, events);
  }
});

test("shiori:recommend review mode is selected through UI instead of --pick args", async () => {
  const cwd = await makeSkillProject();
  const { commands, events, sentUserMessages } = registerExtension();
  try {
    const ctx = makeCommandContext(cwd, {
      inputs: ["auth login"],
      selects: [RECOMMEND_REVIEW_ONLY, "auth-helper"],
      confirms: [false],
    });

    await commands.get("shiori:recommend").handler("--pick ignored", ctx);

    assert.equal(sentUserMessages.length, 0);
    assert.ok(ctx.notifications.some(({ message }) => /Matched 1 skill/.test(message)));
    assert.ok(ctx.notifications.some(({ message }) => /Description: Helps with auth login flows/.test(message)));
  } finally {
    await cleanup(cwd, events);
  }
});

function registerExtension() {
  const commands = new Map();
  const events = new Map();
  const sentUserMessages = [];
  piSkillShiori({
    on(name, handler) {
      events.set(name, handler);
    },
    registerTool() {},
    registerCommand(name, options) {
      commands.set(name, options);
    },
    sendUserMessage(message) {
      sentUserMessages.push(message);
    },
  });
  return { commands, events, sentUserMessages };
}

async function cleanup(cwd, events) {
  await events.get("session_shutdown")?.();
  await rm(cwd, { recursive: true, force: true });
}

function makeCommandContext(cwd, { inputs = [], selects = [], confirms = [] } = {}) {
  const notifications = [];
  return {
    cwd,
    hasUI: true,
    reloadCount: 0,
    notifications,
    async reload() {
      this.reloadCount += 1;
    },
    ui: {
      notify(message, level = "info") {
        notifications.push({ message, level });
      },
      async input() {
        return inputs.shift();
      },
      async select() {
        return selects.shift();
      },
      async confirm() {
        return confirms.shift() ?? false;
      },
    },
  };
}

async function makeSkillProject() {
  const cwd = await mkdtemp(join(tmpdir(), "shiori-command-test-"));
  const skillDir = join(cwd, ".pi", "skills", "auth-helper");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    [
      "---",
      "name: auth-helper",
      "description: Helps with auth login flows",
      "---",
      "# Auth Helper",
      "Use this skill for auth login work.",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(cwd, ".pi", "skill-shiori.yml"),
    [
      "defaults:",
      "  activation: explicit",
      "candidateInjection:",
      "  maxCandidates: 3",
      "  minScore: 0.5",
      "skills:",
      "  auth-helper:",
      "    activation: triggerable",
      "    triggers:",
      "      include:",
      "        - auth",
      "",
    ].join("\n"),
    "utf8",
  );
  return cwd;
}
