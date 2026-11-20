import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import piSkillShiori from "../src/index.ts";
import { captureLoadedExtensionSource } from "../src/extension-source.ts";

test("doctor and stats report source drift without exposing source paths or contents", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "shiori-doctor-source-"));
  const loadedPath = join(cwd, "loaded-extension.ts");
  const privateSourceSentinel = "private-source-content-must-not-appear";
  let events;
  try {
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(join(cwd, ".pi", "skill-shiori.yml"), "alwaysVisible: []\n", "utf8");
    await writeFile(loadedPath, "original loaded code", "utf8");
    const loaded = captureLoadedExtensionSource(pathToFileURL(loadedPath));
    const registered = registerExtension(loaded);
    events = registered.events;
    const { commands } = registered;
    const ctx = makeContext(cwd);

    await commands.get("shiori:doctor").handler("", ctx);
    const currentDoctor = ctx.notifications.at(-1);
    assert.equal(currentDoctor.level, "info");
    assert.equal((currentDoctor.message.match(/^extensionSource:/gm) ?? []).length, 1);
    assert.match(currentDoctor.message, /extensionSource: current$/m);

    await writeFile(loadedPath, `edited code: ${privateSourceSentinel}`, "utf8");
    await commands.get("shiori:doctor").handler("", ctx);
    const changedDoctor = ctx.notifications.at(-1);
    assert.equal(changedDoctor.level, "warning");
    assert.match(
      changedDoctor.message,
      /extensionSource: changed on disk — restart Pi to load the new extension code; \/shiori:reload cannot replace cached modules$/m,
    );
    assert.equal(changedDoctor.message.includes(loadedPath), false);
    assert.equal(changedDoctor.message.includes(privateSourceSentinel), false);

    await commands.get("shiori:stats").handler("", ctx);
    const payload = JSON.parse(ctx.notifications.at(-1).message.slice(ctx.notifications.at(-1).message.indexOf("{")));
    assert.equal(payload.extensionSource.status, "changed");
    assert.notEqual(payload.extensionSource.capturedSha256, payload.extensionSource.diskSha256);
    assert.equal(JSON.stringify(payload.extensionSource).includes(loadedPath), false);
    assert.equal(JSON.stringify(payload.extensionSource).includes(privateSourceSentinel), false);
    assert.deepEqual(
      Object.keys(payload).slice(0, 13),
      [
        "inventoryCount",
        "duplicateCount",
        "candidateHitCount",
        "zeroCandidateCount",
        "loadedSkillCount",
        "explicitInvocationCount",
        "retrievalBackend",
        "suppressionStatus",
        "inventoryRefreshCount",
        "inventoryAutoRefreshCount",
        "timing",
        "lastReloadAt",
        "recommendationFeedback",
      ],
    );
    assert.equal(Object.keys(payload).at(-1), "extensionSource");
    assert.equal(ctx.reloadCount, 0);
  } finally {
    await events?.get("session_shutdown")?.();
    await rm(cwd, { recursive: true, force: true });
  }
});

test("unavailable source diagnostics do not raise the doctor notify level", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "shiori-doctor-unavailable-"));
  let events;
  try {
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(join(cwd, ".pi", "skill-shiori.yml"), "alwaysVisible: []\n", "utf8");
    const registered = registerExtension(captureLoadedExtensionSource("data:text/javascript,bundled"));
    events = registered.events;
    const { commands } = registered;
    const ctx = makeContext(cwd);
    await commands.get("shiori:doctor").handler("", ctx);
    assert.equal(ctx.notifications.at(-1).level, "info");
    assert.match(ctx.notifications.at(-1).message, /extensionSource: unavailable \(bundle-path-unsupported\)$/m);

    await commands.get("shiori:stats").handler("", ctx);
    const payload = JSON.parse(ctx.notifications.at(-1).message.slice(ctx.notifications.at(-1).message.indexOf("{")));
    assert.equal(payload.extensionSource.status, "unavailable");
    assert.equal(payload.extensionSource.reason, "bundle-path-unsupported");
  } finally {
    await events?.get("session_shutdown")?.();
    await rm(cwd, { recursive: true, force: true });
  }
});

function registerExtension(loadedSource) {
  const commands = new Map();
  const events = new Map();
  piSkillShiori({
    on(name, handler) {
      events.set(name, handler);
    },
    registerTool() {},
    registerCommand(name, options) {
      commands.set(name, options);
    },
    sendUserMessage() {},
  }, loadedSource);
  return { commands, events };
}

function makeContext(cwd) {
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
      async select() {
        return undefined;
      },
    },
  };
}
