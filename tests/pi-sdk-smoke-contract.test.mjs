import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  behaviorAssertions,
  normalizeVolatileText,
  parseJsonLines,
  SDK_VERSIONS,
  VERIFICATION_CONTRACT,
} from "../scripts/pi-sdk-smoke-contract.mjs";

test("curated Pi SDK report is available at the canonical lowercase path", async () => {
  const report = JSON.parse(await readFile(new URL("../docs/verification/pi-sdk-smoke.json", import.meta.url), "utf8"));
  const requiredAssertions = {
    extension_load: ["extension_registered"],
    happy_path: ["feature_response"],
    error_path: ["handled_error"],
    reload_cleanup: ["reloaded_extension_registered", "reloaded_feature_response", "clean_shutdown"],
    host_shell: ["native_shell_boundary"],
  };

  assert.equal(report.schema_version, 1);
  assert.equal(report.verification_contract, VERIFICATION_CONTRACT);
  assert.deepEqual(report.sdk_versions, SDK_VERSIONS);
  assert.equal(report.unhandled_errors, 0);
  assert.equal(report.extension_load_errors, 0);
  assert.deepEqual(report.cases.map(({ name }) => name), Object.keys(requiredAssertions));
  for (const item of report.cases) {
    assert.equal(item.passed, true, `${item.name} report case must pass`);
    assert.equal(item.exit_code, 0, `${item.name} report case must exit cleanly`);
    const assertions = new Set(item.assertions.map(({ id, passed }) => {
      assert.equal(passed, true, `${item.name}.${id} report assertion must pass`);
      return id;
    }));
    for (const id of requiredAssertions[item.name]) assert.ok(assertions.has(id), `${item.name} report must contain ${id}`);
  }
});

const commands = [
  { name: "shiori:doctor" },
  { name: "shiori:stats" },
  { name: "shiori:reload" },
];
const registration = (names = commands) => [{ type: "response", id: "load", command: "get_commands", success: true, data: { commands: names } }];
const promptResponse = (id, success = true, disposition = "handled") => ({
  type: "response", id, command: "prompt", success, data: { disposition },
});
const feature = {
  type: "extension_ui_request",
  method: "notify",
  notifyType: "info",
  message: "Matched 1 skill(s): smoke-skill [trigger]",
};
const cancellation = {
  type: "extension_ui_request",
  method: "notify",
  notifyType: "info",
  message: "Recommendation cancelled.",
};
const stats = {
  type: "extension_ui_request",
  method: "notify",
  notifyType: "info",
  message: `Summary\n{\n  "inventoryRefreshCount": 1\n}`,
};

test("SDK smoke contract and JSONL parser accept LF and CRLF", () => {
  assert.equal(VERIFICATION_CONTRACT, "pi-sdk-behavior-v2");
  assert.deepEqual(SDK_VERSIONS, {
    "@earendil-works/pi-agent-core": "1.1.0",
    "@earendil-works/pi-ai": "1.1.0",
    "@earendil-works/pi-coding-agent": "1.1.0",
    "@earendil-works/pi-tui": "1.1.0",
  });
  const row = { type: "response", command: "get_commands", success: true };
  assert.deepEqual(parseJsonLines(`noise\r\n${JSON.stringify(row)}\n\n`), [row]);
});

test("smoke evidence normalizes volatile IDs, timestamps, and timings", () => {
  const first = normalizeVolatileText('id="12345678-1234-1234-1234-123456789abc" at 2026-10-12T01:02:03.456Z last=9.25ms "lastMs":9.25');
  const second = normalizeVolatileText('id="abcdefab-cdef-abcd-efab-cdefabcdefab" at 2026-11-13T04:05:06Z last=2ms "lastMs":2');
  assert.equal(first, 'id="<RPC_ID>" at <TIMESTAMP> last=<DURATION> "lastMs":"<DURATION>"');
  assert.equal(second, first);
  assert.equal(normalizeVolatileText('message=\\"lastMs\\": 8.75'), 'message=\\"lastMs\\": "<DURATION>"');
});

test("extension registration requires the actual Shiori command", () => {
  assert.equal(behaviorAssertions("extension_load", { responses: registration() })[0].passed, true);
  for (const responses of [[], registration([]), registration([{ name: "other:doctor" }])]) {
    assert.equal(behaviorAssertions("extension_load", { responses })[0].passed, false);
  }
});

test("feature response requires handled Pi prompt and actual Shiori recommendation", () => {
  const good = behaviorAssertions("happy_path", { responses: [promptResponse("happy-prompt")], notifications: [feature] });
  assert.equal(good[0].id, "feature_response");
  assert.equal(good[0].passed, true);
  for (const observation of [
    { responses: [], notifications: [feature] },
    { responses: [promptResponse("happy-prompt", false)], notifications: [feature] },
    { responses: [promptResponse("happy-prompt")], notifications: [] },
    { responses: [promptResponse("happy-prompt")], notifications: [{ ...feature, message: "Matched 1 skill(s): other-skill" }] },
  ]) {
    assert.equal(behaviorAssertions("happy_path", observation)[0].passed, false);
  }
});

test("RPC cancellation path requires handled Shiori notice rather than an incidental successful exit", () => {
  assert.equal(behaviorAssertions("error_path", {
    responses: [promptResponse("error-prompt")], notifications: [cancellation],
  })[0].passed, true);
  for (const observation of [
    { responses: [], notifications: [cancellation] },
    { responses: [promptResponse("error-prompt", false)], notifications: [cancellation] },
    { responses: [promptResponse("error-prompt")], notifications: [] },
    { responses: [promptResponse("error-prompt")], notifications: [{ ...cancellation, message: "unexpected" }] },
  ]) {
    assert.equal(behaviorAssertions("error_path", observation)[0].passed, false);
  }
});

test("reload requires actual inventory refresh, second-host feature response, and clean process exits", () => {
  const good = behaviorAssertions("reload_cleanup", {
    firstNotifications: [stats, feature],
    firstExitCode: 0,
    firstResponses: registration(),
    secondResponses: [...registration(), promptResponse("reload-recommend")],
    secondNotifications: [feature],
    secondExitCode: 0,
    fullOutput: "",
  });
  assert.deepEqual(good.map((item) => item.id), [
    "inventory_reload", "reloaded_extension_registered", "reloaded_feature_response", "clean_shutdown",
  ]);
  assert.ok(good.every((item) => item.passed));
  assert.equal(behaviorAssertions("reload_cleanup", {
    firstNotifications: [stats, { ...stats, message: `Summary\n{\n  "inventoryRefreshCount": 2\n}` }, feature],
    firstExitCode: 0,
    firstResponses: registration(),
    secondResponses: [...registration(), promptResponse("reload-recommend")],
    secondNotifications: [feature],
    secondExitCode: 0,
    fullOutput: "",
  })[0].passed, false);
  const missingCases = [
    { firstNotifications: [], firstExitCode: 0, firstResponses: registration(), secondResponses: registration(), secondNotifications: [feature], secondExitCode: 0, fullOutput: "" },
    { firstNotifications: [stats], firstExitCode: 0, firstResponses: [], secondResponses: registration(), secondNotifications: [feature], secondExitCode: 0, fullOutput: "" },
    { firstNotifications: [stats], firstExitCode: 0, firstResponses: registration(), secondResponses: [], secondNotifications: [feature], secondExitCode: 0, fullOutput: "" },
    { firstNotifications: [stats], firstExitCode: 1, firstResponses: registration(), secondResponses: registration(), secondNotifications: [feature], secondExitCode: 0, fullOutput: "" },
    { firstNotifications: [stats], firstExitCode: 0, firstResponses: registration(), secondResponses: registration(), secondNotifications: [feature], secondExitCode: 0, fullOutput: "shutdown error" },
  ];
  for (const observation of missingCases) {
    assert.ok(behaviorAssertions("reload_cleanup", observation).some((item) => !item.passed));
  }
});

test("native shell requires the exact pinned Pi version and successful process exit", () => {
  assert.equal(behaviorAssertions("host_shell", { exit_code: 0, fullOutput: "1.1.0\r\n", expectedVersion: "1.1.0" })[0].passed, true);
  for (const [exit_code, fullOutput] of [[1, "1.1.0"], [0, "11.1.0"], [0, "1.1.0\nextra"]]) {
    assert.equal(behaviorAssertions("host_shell", { exit_code, fullOutput, expectedVersion: "1.1.0" })[0].passed, false);
  }
});
