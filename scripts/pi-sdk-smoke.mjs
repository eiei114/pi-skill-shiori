import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import {
  behaviorAssertions,
  EXTENSION_LOAD_ERROR_PATTERN,
  parseJsonLines,
  SDK_NAMES,
  SDK_VERSIONS,
  UNHANDLED_ERROR_PATTERN,
  normalizeVolatileText,
  VERIFICATION_CONTRACT,
} from "./pi-sdk-smoke-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const reportPath = resolve(root, "Docs/verification/pi-sdk-smoke.json");
const timeoutMs = 15_000;
const cleanupGraceMs = 1_000;
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const packageManifest = readJson(resolve(root, "package.json"));
const sdkVersions = Object.fromEntries(SDK_NAMES.map((name) => [
  name,
  readJson(resolve(root, "node_modules", name, "package.json")).version,
]));

for (const name of SDK_NAMES) {
  if (packageManifest.devDependencies?.[name] !== SDK_VERSIONS[name]
    || sdkVersions[name] !== SDK_VERSIONS[name]) {
    throw new Error(`Smoke requires exact ${SDK_VERSIONS[name]} dev/test and installed SDK pin for ${name}; got ${packageManifest.devDependencies?.[name]} / ${sdkVersions[name]}`);
  }
}

const codingAgent = readJson(resolve(root, "node_modules/@earendil-works/pi-coding-agent/package.json"));
const piCli = resolve(root, "node_modules/@earendil-works/pi-coding-agent", codingAgent.bin.pi);
const agentDir = mkdtempSync(resolve(tmpdir(), "shiori-pi-smoke-agent-"));
const vaultDir = mkdtempSync(resolve(tmpdir(), "shiori-pi-smoke-vault-"));
const homeDir = mkdtempSync(resolve(tmpdir(), "shiori-pi-smoke-home-"));
const extensionPath = resolve(root, "src/index.ts");
const skillName = "smoke-skill";
const skillDirectory = resolve(vaultDir, ".pi/skills", skillName);
mkdirSync(skillDirectory, { recursive: true });
writeFileSync(resolve(skillDirectory, "SKILL.md"), [
  "---",
  `name: ${skillName}`,
  "description: Deterministic Pi SDK compatibility smoke fixture",
  "---",
  "# Smoke Skill",
  "Use this skill to verify actual Shiori inventory discovery.",
  "",
].join("\n"), "utf8");
mkdirSync(resolve(vaultDir, ".pi"), { recursive: true });
writeFileSync(resolve(vaultDir, ".pi/skill-shiori.yml"), [
  "defaults:",
  "  activation: explicit",
  "candidateInjection:",
  "  maxCandidates: 3",
  "  minScore: 0.5",
  "skills:",
  "  smoke-skill:",
  "    activation: triggerable",
  "    triggers:",
  "      include:",
  "        - pi sdk compatibility smoke",
  "",
].join("\n"), "utf8");

const isolatedTempDir = resolve(homeDir, "temp");
mkdirSync(isolatedTempDir, { recursive: true });
const env = {
  ...process.env,
  HOME: homeDir,
  USERPROFILE: homeDir,
  APPDATA: resolve(homeDir, "AppData/Roaming"),
  LOCALAPPDATA: resolve(homeDir, "AppData/Local"),
  XDG_CONFIG_HOME: resolve(homeDir, ".config"),
  XDG_DATA_HOME: resolve(homeDir, ".local/share"),
  TEMP: isolatedTempDir,
  TMP: isolatedTempDir,
  PI_CODING_AGENT_DIR: agentDir,
  PI_OFFLINE: "1",
};
for (const key of Object.keys(env)) {
  if ((key.startsWith("PI_") && !["PI_CODING_AGENT_DIR", "PI_OFFLINE"].includes(key))
    || /_API_KEY$|_AUTH_TOKEN$|^AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|BEARER_TOKEN_BEDROCK)$/.test(key)) {
    delete env[key];
  }
}

function makeRpcArgs() {
  return [piCli, "--offline", "--no-session", "--no-builtin-tools", "--no-extensions",
    "--no-skills", "--no-context-files", "--no-prompt-templates", "--no-mcp", "-e", extensionPath,
    "--mode", "rpc"];
}

function startProcess(command, args, cwd, deadline, onRpcRow) {
  const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let stdout = "";
  let stderr = "";
  let pendingLine = "";
  const rows = [];
  const waiters = new Set();
  let resolveExit;
  const exitPromise = new Promise((resolveExitPromise) => { resolveExit = resolveExitPromise; });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    pendingLine += chunk;
    const lines = pendingLine.split(/\r?\n/);
    pendingLine = lines.pop() ?? "";
    for (const line of lines) {
      const parsed = parseJsonLines(line)[0];
      if (parsed) {
        rows.push(parsed);
        onRpcRow?.(parsed, send);
      }
    }
    for (const waiter of waiters) {
      const found = rows.find(waiter.predicate);
      if (found) waiter.finish(found);
    }
  });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", (error) => {
    stderr += `\nProcess spawn error: ${error.message}`;
    resolveExit({ code: null, signal: null, error });
  });
  child.on("close", (code, signal) => resolveExit({ code, signal }));

  function waitFor(predicate, description) {
    const existing = rows.find(predicate);
    if (existing) return Promise.resolve(existing);
    const remaining = deadline - Date.now();
    if (remaining <= 0) return Promise.reject(new Error(`15-second deadline exceeded waiting for ${description}`));
    return new Promise((resolveWait, rejectWait) => {
      const waiter = {
        predicate,
        finish(value) {
          clearTimeout(timer);
          waiters.delete(waiter);
          resolveWait(value);
        },
      };
      const timer = setTimeout(() => {
        waiters.delete(waiter);
        rejectWait(new Error(`15-second deadline exceeded waiting for ${description}`));
      }, remaining);
      waiters.add(waiter);
      const found = rows.find(predicate);
      if (found) waiter.finish(found);
    });
  }

  function send(commandObject) {
    if (child.stdin.destroyed || child.stdin.writableEnded) throw new Error("Pi RPC stdin is already closed");
    child.stdin.write(`${JSON.stringify(commandObject)}\n`);
  }

  async function waitForExit() {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("15-second deadline exceeded waiting for actual Pi process exit");
    let timer;
    try {
      return await Promise.race([
        exitPromise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("15-second deadline exceeded waiting for actual Pi process exit")), remaining);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function terminateOwnedChild() {
    child.stdin.destroy();
    if (child.exitCode !== null) return;
    const cleanupDeadline = Date.now() + cleanupGraceMs;
    const waitUntil = async (deadlineAt) => {
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) return;
      let timer;
      await Promise.race([
        exitPromise,
        new Promise((resolveWait) => { timer = setTimeout(resolveWait, remaining); }),
      ]);
      clearTimeout(timer);
    };
    if (process.platform === "win32" && child.pid) {
      spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        encoding: "utf8", timeout: Math.max(1, cleanupGraceMs - 300), windowsHide: true,
      });
      await waitUntil(cleanupDeadline);
    } else {
      child.kill("SIGTERM");
      await waitUntil(Math.min(cleanupDeadline, Date.now() + cleanupGraceMs - 300));
      if (child.exitCode === null) child.kill("SIGKILL");
      await waitUntil(cleanupDeadline);
    }
  }

  return {
    child,
    rows,
    send,
    waitFor,
    waitForExit,
    terminateOwnedChild,
    output: () => ({ stdout, stderr, fullOutput: `${stdout}${stderr}` }),
  };
}

async function runRpcProcess(commands, notifications, deadline, uiBehavior = "none") {
  const recommendationReview = uiBehavior.includes("recommend-review");
  const runtimeReload = uiBehavior.includes("reload-runtime");
  const processHandle = startProcess(process.execPath, makeRpcArgs(), vaultDir, deadline, (row, send) => {
    if (row?.type !== "extension_ui_request") return;
    if (row.method === "input" && row.title === "What do you want help with?") {
      if (uiBehavior === "recommend-cancel") {
        send({ type: "extension_ui_response", id: row.id, cancelled: true });
      } else if (recommendationReview) {
        send({ type: "extension_ui_response", id: row.id, value: "pi sdk compatibility smoke" });
      }
      return;
    }
    if (row.method !== "select") return;
    if (row.title === "Reload what?" && runtimeReload) {
      send({ type: "extension_ui_response", id: row.id, value: "Shiori inventory + Pi runtime resources" });
    } else if (row.title === "How should Shiori use these recommendations?" && recommendationReview) {
      send({ type: "extension_ui_response", id: row.id, value: "Review recommendations only" });
    } else if (row.title === "Follow up on a recommendation:" && recommendationReview) {
      send({ type: "extension_ui_response", id: row.id, value: "Done" });
    }
  });
  let timedOut = false;
  let error;
  let exit;
  try {
    for (const command of commands) {
      processHandle.send(command);
      await processHandle.waitFor((row) => row?.type === "response" && row.id === command.id, `${command.type} response`);
    }
    for (const [predicate, description] of notifications) {
      await processHandle.waitFor(predicate, description);
    }
    processHandle.child.stdin.end();
    exit = await processHandle.waitForExit();
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    timedOut = /deadline exceeded/.test(error);
    await processHandle.terminateOwnedChild();
    exit = await processHandle.waitForExit().catch(() => ({ code: null, signal: null }));
  }
  const output = processHandle.output();
  return {
    ...output,
    rows: [...processHandle.rows],
    responses: processHandle.rows.filter((row) => row?.type === "response"),
    notifications: processHandle.rows.filter((row) => row?.type === "extension_ui_request" && row.method === "notify"),
    exitCode: exit?.code,
    timedOut,
    error,
  };
}

function commandRegistration(id) {
  return { type: "get_commands", id };
}

function promptCommand(id, message) {
  return { type: "prompt", id, message };
}

function recommendationNotification(row) {
  return row?.type === "extension_ui_request" && row.method === "notify"
    && typeof row.message === "string" && row.message.includes("Matched 1 skill(s):")
    && row.message.includes(skillName);
}

function caseOutput(name, first, second) {
  const sections = [
    `[${name}] Pi SDK ${sdkVersions["@earendil-works/pi-coding-agent"]}`,
    first ? `[first process stdout]\n${first.stdout}\n[first process stderr]\n${first.stderr}` : "",
    second ? `[second process stdout]\n${second.stdout}\n[second process stderr]\n${second.stderr}` : "",
    first?.error ? `first process probe error: ${first.error}` : "",
    second?.error ? `second process probe error: ${second.error}` : "",
  ].filter(Boolean).join("\n");
  return sections;
}

function sanitizeEvidence(text) {
  const replacements = [
    [root, "<REPOSITORY>"],
    [agentDir, "<ISOLATED_PI_AGENT_DIR>"],
    [vaultDir, "<SMOKE_VAULT>"],
    [homeDir, "<ISOLATED_HOME>"],
    [tmpdir(), "<TEMP_DIR>"],
    [homedir(), "<USER_HOME>"],
  ].filter(([path]) => path).sort(([left], [right]) => right.length - left.length);
  return normalizeVolatileText(replacements.reduce((output, [path, replacement]) => {
    const escapedPath = JSON.stringify(path).slice(1, -1);
    return [path, escapedPath].reduce((sanitized, variant) => sanitized.replace(
      new RegExp(variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
      replacement,
    ), output);
  }, text));
}

function recordCase(name, observation, fullOutput, exitCode, evidence = fullOutput) {
  const assertions = behaviorAssertions(name, observation);
  return {
    name,
    command: name === "host_shell" ? "npm run smoke:pi (native host shell launches the locally pinned Pi CLI)" : "npm run smoke:pi (actual locally pinned Pi RPC host and Shiori extension)",
    exit_code: exitCode,
    passed: exitCode === 0 && assertions.every((item) => item.passed)
      && !UNHANDLED_ERROR_PATTERN.test(fullOutput)
      && !EXTENSION_LOAD_ERROR_PATTERN.test(fullOutput),
    evidence: sanitizeEvidence(evidence).slice(-6_000),
    assertions,
    hasUnhandledError: UNHANDLED_ERROR_PATTERN.test(fullOutput),
    hasExtensionLoadError: EXTENSION_LOAD_ERROR_PATTERN.test(fullOutput),
  };
}

const cases = [];
try {
  const registration = await runRpcProcess([commandRegistration("load-commands")], [], Date.now() + timeoutMs);
  let output = caseOutput("extension_load", registration);
  cases.push(recordCase("extension_load", { responses: registration.responses }, registration.fullOutput,
    registration.exitCode ?? 1, output));

  const happy = await runRpcProcess(
    [commandRegistration("happy-commands"), promptCommand("happy-prompt", "/shiori:recommend")],
    [[recommendationNotification, "Shiori recommendation feature response"]],
    Date.now() + timeoutMs,
    "recommend-review",
  );
  output = caseOutput("happy_path", happy);
  cases.push(recordCase("happy_path", { responses: happy.responses, notifications: happy.notifications }, happy.fullOutput,
    happy.exitCode ?? 1, output));

  const error = await runRpcProcess(
    [commandRegistration("error-commands"), promptCommand("error-prompt", "/shiori:recommend")],
    [[(row) => row?.type === "extension_ui_request" && row.method === "notify"
      && row.notifyType === "info" && row.message === "Recommendation cancelled.", "handled recommendation cancellation"]],
    Date.now() + timeoutMs,
    "recommend-cancel",
  );
  output = caseOutput("error_path", error);
  cases.push(recordCase("error_path", { responses: error.responses, notifications: error.notifications }, error.fullOutput,
    error.exitCode ?? 1, output));

  const reloadDeadline = Date.now() + timeoutMs;
  const first = await runRpcProcess(
    [
      commandRegistration("reload-first-commands"),
      promptCommand("reload-stats-before", "/shiori:stats"),
      promptCommand("reload-inventory", "/shiori:reload"),
      commandRegistration("reload-after-commands"),
      promptCommand("reload-stats-after", "/shiori:stats"),
      promptCommand("reload-recommend", "/shiori:recommend"),
    ],
    [
      [(row) => row?.type === "extension_ui_request" && row.method === "notify"
        && typeof row.message === "string" && row.message.includes('"inventoryRefreshCount"'), "session stats after runtime reload"],
      [recommendationNotification, "recommendation feature response after runtime reload"],
    ],
    reloadDeadline,
    "reload-runtime-recommend-review",
  );
  const second = await runRpcProcess(
    [commandRegistration("reload-second-commands"), promptCommand("reload-recommend", "/shiori:recommend")],
    [[recommendationNotification, "reloaded Shiori recommendation feature response"]],
    reloadDeadline,
    "recommend-review",
  );
  const reloadOutput = `${first.fullOutput}\n${second.fullOutput}`;
  output = caseOutput("reload_cleanup", first, second);
  cases.push(recordCase("reload_cleanup", {
    firstNotifications: first.notifications,
    firstExitCode: first.exitCode,
    firstResponses: first.responses.filter((row) => row.id === "reload-after-commands"),
    secondResponses: second.responses,
    secondNotifications: second.notifications,
    secondExitCode: second.exitCode,
    fullOutput: reloadOutput,
  }, reloadOutput, first.exitCode === 0 && second.exitCode === 0 ? 0 : 1, output));

  const expectedVersion = SDK_VERSIONS["@earendil-works/pi-coding-agent"];
  let shell;
  let shellArgs;
  if (process.platform === "win32") {
    const quote = (value) => `'${value.replaceAll("'", "''")}'`;
    shell = resolve(process.env.SystemRoot ?? "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
    shellArgs = ["-NoProfile", "-NonInteractive", "-Command",
      `& ${quote(process.execPath)} ${quote(piCli)} --no-extensions --version; exit $LASTEXITCODE`];
  } else {
    shell = "/bin/sh";
    shellArgs = ["-c", '"$1" "$2" --no-extensions --version', "pi-host-shell", process.execPath, piCli];
  }
  const shellRun = startProcess(shell, shellArgs, vaultDir, Date.now() + timeoutMs);
  let shellExit;
  let shellError;
  let shellTimedOut = false;
  try {
    shellExit = await shellRun.waitForExit();
  } catch (caught) {
    shellError = caught instanceof Error ? caught.message : String(caught);
    shellTimedOut = /deadline exceeded/.test(shellError);
    await shellRun.terminateOwnedChild();
    shellExit = await shellRun.waitForExit().catch(() => ({ code: null, signal: null }));
  }
  const shellOutput = shellRun.output();
  output = `${shellOutput.stdout}${shellOutput.stderr}${shellError ? `\n${shellError}` : ""}`.slice(-6_000);
  cases.push(recordCase("host_shell", {
    exit_code: shellExit?.code ?? 1,
    fullOutput: `${shellOutput.stdout}${shellOutput.stderr}`,
    expectedVersion,
  }, output, shellExit?.code ?? 1));
  if (shellTimedOut) cases.at(-1).passed = false;
} finally {
  rmSync(agentDir, { recursive: true, force: true });
  rmSync(vaultDir, { recursive: true, force: true });
  rmSync(homeDir, { recursive: true, force: true });
}

const report = {
  schema_version: 1,
  verification_contract: VERIFICATION_CONTRACT,
  sdk_versions: sdkVersions,
  platform: process.platform,
  model_inference: "none; actual Pi host executes local Shiori slash commands in RPC mode",
  boundary: "The Pi SDK host, extension loader, extension lifecycle and Shiori commands are real. The deterministic smoke skill is filesystem input; no provider/model call or mocked host is used. Pi settings, home and temp paths are isolated and removed after the checks.",
  unhandled_errors: cases.filter((item) => item.hasUnhandledError).length,
  extension_load_errors: cases.filter((item) => item.hasExtensionLoadError).length,
  cases: cases.map(({ hasUnhandledError, hasExtensionLoadError, ...item }) => ({
    ...item,
    evidence: item.evidence,
  })),
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  verification_contract: VERIFICATION_CONTRACT,
  platform: process.platform,
  unhandled_errors: report.unhandled_errors,
  extension_load_errors: report.extension_load_errors,
  cases: cases.map(({ name, exit_code, passed, assertions }) => ({
    name, exit_code, passed, assertions: assertions.map(({ id, passed: assertionPassed }) => ({ id, passed: assertionPassed })),
  })),
}));
if (cases.length !== 5 || cases.some((item) => !item.passed)
  || report.unhandled_errors !== 0 || report.extension_load_errors !== 0) {
  process.exitCode = 1;
}
