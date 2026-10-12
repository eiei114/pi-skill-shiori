import assert from "node:assert/strict";
import test from "node:test";
import {
  behaviorAssertions,
  parseJsonLines,
  SDK_VERSIONS,
  VERIFICATION_CONTRACT,
} from "../scripts/pi-sdk-smoke-contract.mjs";

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
