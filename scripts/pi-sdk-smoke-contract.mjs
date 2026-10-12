export const VERIFICATION_CONTRACT = "pi-sdk-behavior-v2";
export const SDK_NAMES = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
];
export const SDK_VERSIONS = Object.fromEntries(SDK_NAMES.map((name) => [name, "1.1.0"]));
export const UNHANDLED_ERROR_PATTERN = /UnhandledPromiseRejection|uncaught exception|shutdown error/i;
export const EXTENSION_LOAD_ERROR_PATTERN = /Failed to load extension|Error loading extension/i;

export function parseJsonLines(output) {
  return output.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

function assertion(id, expected, observed, passed) {
  return { id, expected, observed: JSON.stringify(observed), passed: passed === true };
}

function registeredCommands(responses) {
  return responses.find((row) => row?.type === "response" && row.command === "get_commands")?.data?.commands ?? [];
}

function commandResponse(responses, id) {
  return responses.find((row) => row?.type === "response" && row.id === id);
}

function notification(notifications, match) {
  return notifications.find((row) => row?.type === "extension_ui_request"
    && row.method === "notify" && match(row));
}

function hasFeatureResponse(notifications) {
  return notification(notifications, (row) => typeof row.message === "string"
    && row.message.includes("Matched 1 skill(s):")
    && row.message.includes("smoke-skill"));
}

function statsPayload(notifications) {
  const stats = notifications.findLast((row) => row?.type === "extension_ui_request"
    && row.method === "notify" && typeof row.message === "string"
    && row.message.includes('"inventoryRefreshCount"'));
  if (!stats) return undefined;
  try {
    const start = stats.message.lastIndexOf("\n{");
    return JSON.parse(stats.message.slice(start + 1));
  } catch {
    return undefined;
  }
}

export function behaviorAssertions(name, observation) {
  const { responses = [], notifications = [] } = observation;
  if (name === "extension_load") {
    const commands = registeredCommands(responses);
    return [assertion(
      "extension_registered",
      "The actual Pi host lists Shiori's registered doctor command.",
      { commands: commands.map((command) => command.name) },
      commands.some((command) => command.name === "shiori:doctor"),
    )];
  }
  if (name === "happy_path") {
    const response = commandResponse(responses, "happy-prompt");
    const feature = hasFeatureResponse(notifications);
    return [assertion(
      "feature_response",
      "Pi handles Shiori's interactive recommendation command and the real extension returns its discovered smoke-skill.",
      { response: response ?? null, notification: feature ?? null },
      response?.success === true && response.data?.disposition === "handled" && !!feature,
    )];
  }
  if (name === "error_path") {
    const response = commandResponse(responses, "error-prompt");
    const cancelled = notification(notifications, (row) => row.notifyType === "info"
      && row.message === "Recommendation cancelled.");
    return [assertion(
      "handled_error",
      "Cancelling Shiori's actual RPC input dialog is handled with its cancellation notice and no model call.",
      { response: response ?? null, cancelled: cancelled ?? null },
      response?.success === true && response.data?.disposition === "handled" && !!cancelled,
    )];
  }
  if (name === "reload_cleanup") {
    const postReloadStats = statsPayload(observation.firstNotifications ?? []);
    const postReloadCommands = observation.firstResponses ?? [];
    const reloadedCommands = registeredCommands(observation.secondResponses ?? []);
    const secondFeature = hasFeatureResponse(observation.secondNotifications ?? []);
    const secondPrompt = commandResponse(observation.secondResponses ?? [], "reload-recommend");
    const clean = observation.firstExitCode === 0 && observation.secondExitCode === 0
      && !UNHANDLED_ERROR_PATTERN.test(observation.fullOutput ?? "")
      && !EXTENSION_LOAD_ERROR_PATTERN.test(observation.fullOutput ?? "");
    return [
      assertion(
        "inventory_reload",
        "Runtime reload re-registers Shiori and resets its session-local inventory counter to the single new session_start refresh.",
        {
          post_reload_commands: registeredCommands(postReloadCommands).map((command) => command.name),
          post_reload_inventory_refresh_count: postReloadStats?.inventoryRefreshCount ?? null,
        },
        registeredCommands(postReloadCommands).some((command) => command.name === "shiori:doctor")
          && postReloadStats?.inventoryRefreshCount === 1,
      ),
      assertion(
        "reloaded_extension_registered",
        "A second actual Pi process registers Shiori again after the first process shuts down.",
        { commands: reloadedCommands.map((command) => command.name) },
        reloadedCommands.some((command) => command.name === "shiori:doctor"),
      ),
      assertion(
        "reloaded_feature_response",
        "The second process handles Shiori's interactive recommendation and returns the discovered skill.",
        { response: secondPrompt ?? null, notification: secondFeature ?? null },
        secondPrompt?.success === true && secondPrompt.data?.disposition === "handled" && !!secondFeature,
      ),
      assertion(
        "clean_shutdown",
        "Both actual Pi processes exit with status 0 and emit no unhandled or shutdown errors.",
        {
          first_exit_code: observation.firstExitCode ?? null,
          second_exit_code: observation.secondExitCode ?? null,
          runtime_errors: (observation.fullOutput ?? "").match(UNHANDLED_ERROR_PATTERN)?.[0] ?? null,
          extension_load_errors: (observation.fullOutput ?? "").match(EXTENSION_LOAD_ERROR_PATTERN)?.[0] ?? null,
        },
        clean,
      ),
    ];
  }
  if (name === "host_shell") {
    const expectedVersion = observation.expectedVersion;
    return [assertion(
      "native_shell_boundary",
      "The native host shell launches the locally pinned Pi CLI and returns exactly its SDK version.",
      { exit_code: observation.exit_code, output: (observation.fullOutput ?? "").trim(), expectedVersion },
      observation.exit_code === 0 && (observation.fullOutput ?? "").trim() === expectedVersion,
    )];
  }
  throw new Error(`Unknown Pi smoke case: ${name}`);
}
