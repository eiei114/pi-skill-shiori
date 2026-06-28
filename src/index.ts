import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { readFile, writeFile } from "node:fs/promises";
import { evaluateAlwaysVisible, formatAlwaysVisibleDiagnostics } from "./always-visible.js";
import { findDuplicates, formatInventoryRoots, isAutoRefreshEnabled, isInventoryStale, refreshSkillInventory } from "./inventory.js";
import type { SkillIndex } from "./indexer.js";
import { loadRecommendedSkills } from "./load-skills.js";
import { formatPlanningKickoffMessage, isPlanningIntent } from "./planning-kickoff.js";
import { createStats } from "./metrics.js";
import { getPolicyPath, loadPolicy } from "./policy.js";
import {
  formatCandidateDetail,
  formatCandidateInjection,
  formatLoadedSkillsSummary,
  formatRecommendKickoffMessage,
  suppressSkillCatalog,
} from "./prompt.js";
import { retrieveCandidatesExpanded } from "./retrieval-expanded.js";
import type { SkillRecord } from "./types.js";

interface ShioriLoadDetails {
  skill: string;
  path: string;
  bytes: number;
  loadedAt: string;
}

const SHIORI_CODE_MARKER = "prompt-boundary-v3";
const RECOMMEND_MAX_CANDIDATES = 5;
const RELOAD_INVENTORY_ONLY = "Shiori inventory only";
const RELOAD_WITH_RUNTIME = "Shiori inventory + Pi runtime resources";
const RECOMMEND_QUEUE_TASK = "Pre-load matches and queue task for agent";
const RECOMMEND_REVIEW_ONLY = "Review recommendations only";
const CANCEL_CHOICE = "Cancel";

export default function piSkillShiori(pi: ExtensionAPI) {
  let index: SkillIndex | undefined;
  let inventoryFingerprint: string | undefined;
  let inventoryRoots: string[] = [];
  let warnedAlwaysVisibleMissing = new Set<string>();
  const stats = createStats();

  async function reload(cwd: string): Promise<SkillIndex> {
    const policy = await loadPolicy(cwd);
    const inventory = await refreshSkillInventory(cwd, policy, index);
    index = inventory.index;
    inventoryFingerprint = inventory.fingerprint;
    inventoryRoots = inventory.roots;
    stats.inventoryCount = index.skills.length;
    stats.duplicateCount = findDuplicates(index.skills).size;
    stats.lastReloadAt = index.builtAt;
    stats.retrievalBackend = index.retrievalBackend;
    stats.suppressionStatus = policy.zeroCatalog.enabled ? "not-needed" : "disabled";
    stats.inventoryRefreshCount += 1;
    return index;
  }

  async function ensureIndex(cwd: string): Promise<SkillIndex> {
    if (!index || !inventoryFingerprint) {
      return reload(cwd);
    }

    const policy = await loadPolicy(cwd);
    if (!isAutoRefreshEnabled(policy)) {
      return index;
    }

    if (await isInventoryStale(cwd, policy, inventoryFingerprint)) {
      stats.inventoryAutoRefreshCount += 1;
      return reload(cwd);
    }

    return index;
  }

  function withRecommendLimits(current: SkillIndex) {
    return {
      ...current.policy,
      candidateInjection: {
        ...current.policy.candidateInjection,
        maxCandidates: Math.max(current.policy.candidateInjection.maxCandidates, RECOMMEND_MAX_CANDIDATES),
      },
    };
  }

  pi.on("session_start", async (_event, ctx) => {
    await reload(ctx.cwd);
  });

  pi.on("session_shutdown", () => {
    index?.close?.();
    index = undefined;
    inventoryFingerprint = undefined;
    inventoryRoots = [];
  });

  pi.on("input", async (event) => {
    if (/^\/(skill:|shiori:)/.test(event.text.trim())) {
      stats.explicitInvocationCount += 1;
    }
    return { action: "continue" };
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const current = await ensureIndex(ctx.cwd);
    if (!current.policy.zeroCatalog.enabled) return;

    const alwaysVisible = evaluateAlwaysVisible(current.policy.alwaysVisible, current.skills);
    for (const name of alwaysVisible.missing) {
      if (warnedAlwaysVisibleMissing.has(name)) continue;
      warnedAlwaysVisibleMissing.add(name);
      ctx.ui.notify(
        `Pi Skill Shiori: always-visible skill not found in inventory: ${name}`,
        "warning",
      );
    }

    const suppression = suppressSkillCatalog(event.systemPrompt, {
      alwaysVisible: current.policy.alwaysVisible,
      skills: current.skills,
    });
    stats.suppressionStatus = suppression.status;
    if (suppression.status === "failed-pattern-not-found") {
      ctx.ui.notify("Pi Skill Shiori: Skill Catalog suppression pattern not found; leaving system prompt unchanged.", "warning");
    }

    const candidates = retrieveCandidatesExpanded(event.prompt, current.skills, current.policy, current);
    if (candidates.length === 0) stats.zeroCandidateCount += 1;
    else stats.candidateHitCount += 1;

    const injection = formatCandidateInjection(candidates);
    const candidateSection = injection ? `\n\n## Pi Skill Shiori Candidates\n\n${injection}\n` : "";

    return {
      systemPrompt: `${suppression.systemPrompt}${candidateSection}`,
    };
  });

  pi.registerTool({
    name: "shiori_recommend",
    label: "Shiori Recommend",
    description: "Find Agent Skills that match a natural-language task description.",
    promptSnippet: "Search the skill inventory for skills matching a task description",
    promptGuidelines: [
      "Use shiori_recommend when you need to discover which Agent Skills fit a task before loading them.",
      "shiori_recommend may return multiple pre-loaded skills; follow all relevant ones.",
    ],
    parameters: Type.Object({
      task: Type.String({ description: "Natural-language description of what you want to do" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const current = await ensureIndex(ctx.cwd);
      const policy = withRecommendLimits(current);
      const candidates = retrieveCandidatesExpanded(params.task, current.skills, policy, current);
      const loaded = await loadRecommendedSkills(candidates);
      const summary = formatLoadedSkillsSummary(loaded);
      const blocks = loaded.map(({ candidate, content }) => ({
        type: "text" as const,
        text: `## ${candidate.skill.name}\n\n${content}`,
      }));
      return {
        content: summary
          ? [{ type: "text", text: summary }, ...blocks]
          : [{ type: "text", text: "No matching skills for that task." }],
        details: { query: params.task, matches: candidates.map((c) => c.skill.name) },
      };
    },
    renderResult(result, { expanded }, theme) {
      const details = result.details as { query?: string; matches?: string[] } | undefined;
      const names = details?.matches?.join(", ") ?? "none";
      const collapsed = `${theme.fg("success", "✓ Shiori")} ${theme.bold(names)}`;
      if (!expanded) return new Text(collapsed, 0, 0);
      const query = details?.query ? `\n${theme.fg("dim", details.query)}` : "";
      return new Text(`${collapsed}${query}`, 0, 0);
    },
  });

  pi.registerTool({
    name: "shiori_load_skill",
    label: "Shiori Load Skill",
    description: "Load one Agent Skill by name from the Pi Skill Shiori inventory.",
    promptSnippet: "Load an Agent Skill by name after Pi Skill Shiori recommends it.",
    promptGuidelines: [
      "Use shiori_load_skill only when a Pi Skill Shiori candidate is relevant to the user's current request.",
    ],
    parameters: Type.Object({
      skill: Type.String({ description: "Agent Skill name to load" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const current = await ensureIndex(ctx.cwd);
      const record = findSkill(params.skill, current.skills);
      if (!record) throw new Error(`Skill not found: ${params.skill}`);
      const content = await readFile(record.path, "utf8");
      stats.loadedSkillCount += 1;
      const details: ShioriLoadDetails = {
        skill: record.name,
        path: record.path,
        bytes: Buffer.byteLength(content, "utf8"),
        loadedAt: new Date().toISOString(),
      };
      return {
        content: [{ type: "text", text: `Loaded ${record.name} from ${record.path}\n\n${content}` }],
        details,
      };
    },
    renderResult(result, { expanded }, theme) {
      const details = result.details as Partial<ShioriLoadDetails> | undefined;
      if (!details?.skill) {
        return new Text(theme.fg("success", "Loaded skill"), 0, 0);
      }
      const size = typeof details.bytes === "number" ? formatBytes(details.bytes) : "unknown size";
      const collapsed = `${theme.fg("success", "✓ Loaded")} ${theme.bold(details.skill)} ${theme.fg("muted", `(${size})`)}`;
      if (!expanded) return new Text(collapsed, 0, 0);
      const path = details.path ? `\n${theme.fg("dim", details.path)}` : "";
      return new Text(`${collapsed}${path}`, 0, 0);
    },
  });

  pi.registerCommand("shiori:doctor", {
    description: "Show Pi Skill Shiori configuration and inventory status",
    handler: async (_args, ctx) => {
      const current = await ensureIndex(ctx.cwd);
      const duplicates = findDuplicates(current.skills);
      const alwaysVisible = evaluateAlwaysVisible(current.policy.alwaysVisible, current.skills);
      const doctorLines = [
        "Pi Skill Shiori doctor",
        `policy: ${getPolicyPath(ctx.cwd)}`,
        `zeroCatalog: ${current.policy.zeroCatalog.enabled ? "enabled" : "disabled"}`,
        `skills: ${current.skills.length}`,
        `duplicates: ${duplicates.size}`,
        `alwaysVisible: ${current.policy.alwaysVisible.join(", ") || "none"}`,
        ...formatAlwaysVisibleDiagnostics(alwaysVisible),
        "inventoryRoots:",
        ...formatInventoryRoots(inventoryRoots, current.skills).map((line) => `  - ${line}`),
        `autoRefreshOnChange: ${isAutoRefreshEnabled(current.policy) ? "enabled" : "disabled"}`,
        `retrievalBackend: ${current.retrievalBackend}`,
        `suppression: ${stats.suppressionStatus}`,
        `code: ${SHIORI_CODE_MARKER}`,
        `builtAt: ${current.builtAt}`,
      ];
      const hasWarning =
        duplicates.size > 0 ||
        stats.suppressionStatus === "failed-pattern-not-found" ||
        alwaysVisible.missing.length > 0 ||
        alwaysVisible.duplicates.length > 0;
      ctx.ui.notify(doctorLines.join("\n"), hasWarning ? "warning" : "info");
    },
  });

  pi.registerCommand("shiori:reload", {
    description: "Rebuild Pi Skill Shiori inventory and optional Pi runtime resources",
    handler: async (_args, ctx) => {
      let target = RELOAD_INVENTORY_ONLY;
      if (ctx.hasUI) {
        const choice = await ctx.ui.select("Reload what?", [
          RELOAD_INVENTORY_ONLY,
          RELOAD_WITH_RUNTIME,
          CANCEL_CHOICE,
        ]);
        if (!choice || choice === CANCEL_CHOICE) {
          ctx.ui.notify("Reload cancelled.", "info");
          return;
        }
        target = choice;
      }

      await reload(ctx.cwd);
      if (target === RELOAD_WITH_RUNTIME) {
        await ctx.reload();
        return;
      }
      ctx.ui.notify(`Pi Skill Shiori reloaded: ${stats.inventoryCount} skills (${stats.retrievalBackend})`, "info");
    },
  });

  pi.registerCommand("shiori:recommend", {
    description: "Recommend Agent Skills for a natural-language task and queue it for the agent",
    handler: async (_args, ctx) => {
      const current = await ensureIndex(ctx.cwd);
      if (!ctx.hasUI) {
        ctx.ui.notify("Run /shiori:recommend in the Pi UI to enter a task description.", "warning");
        return;
      }

      const input = await ctx.ui.input(
        "What do you want help with?",
        "Describe your task in natural language…",
      );
      const query = input?.trim();
      if (!query) {
        ctx.ui.notify("Recommendation cancelled.", "info");
        return;
      }

      const action = await ctx.ui.select("How should Shiori use these recommendations?", [
        RECOMMEND_QUEUE_TASK,
        RECOMMEND_REVIEW_ONLY,
        CANCEL_CHOICE,
      ]);
      if (!action || action === CANCEL_CHOICE) {
        ctx.ui.notify("Recommendation cancelled.", "info");
        return;
      }

      const policy = withRecommendLimits(current);
      const candidates = retrieveCandidatesExpanded(query, current.skills, policy, current);
      const planning = isPlanningIntent(query);
      const reviewOnly = action === RECOMMEND_REVIEW_ONLY;
      const loaded = planning || reviewOnly ? [] : await loadRecommendedSkills(candidates);
      const summary = planning || reviewOnly
        ? candidates.length > 0
          ? `Matched ${candidates.length} skill(s): ${candidates.map((c) => c.skill.name).join(", ")}`
          : ""
        : formatLoadedSkillsSummary(loaded);

      if (summary) {
        ctx.ui.notify(summary, "info");
      } else {
        ctx.ui.notify("No matching skills for that request.", "warning");
      }

      if (!reviewOnly) {
        const kickoff = isPlanningIntent(query)
          ? formatPlanningKickoffMessage(query, candidates)
          : formatRecommendKickoffMessage(query, loaded);
        pi.sendUserMessage(kickoff);
        ctx.ui.notify(
          isPlanningIntent(query)
            ? "Queued dev-plan intake for the agent."
            : loaded.length > 0
              ? `Pre-loaded ${loaded.length} skill(s) and queued task for the agent.`
              : "Queued task for the agent.",
          "info",
        );
        return;
      }

      if (candidates.length === 0) {
        return;
      }

      const choice = await ctx.ui.select("Follow up on a recommendation:", [
        ...candidates.map((candidate) => candidate.skill.name),
        "Done",
      ]);
      if (!choice || choice === "Done") {
        return;
      }

      const selected = candidates.find((candidate) => candidate.skill.name === choice);
      if (!selected) {
        return;
      }

      ctx.ui.notify(formatCandidateDetail(selected), "info");

      const shouldLoad = await ctx.ui.confirm(
        "Load this skill?",
        `The agent can call shiori_load_skill({ skill: "${selected.skill.name}" }) to read the full SKILL.md.`,
      );
      if (shouldLoad) {
        ctx.ui.notify(
          `Ask the agent to run: shiori_load_skill({ skill: "${selected.skill.name}" })`,
          "info",
        );
      }
    },
  });

  pi.registerCommand("shiori:stats", {
    description: "Show Pi Skill Shiori operational counters",
    handler: async (_args, ctx) => {
      ctx.ui.notify(JSON.stringify(stats, null, 2), "info");
    },
  });

  pi.registerCommand("shiori:bootstrap", {
    description: "Generate a review policy draft from discovered skill descriptions",
    handler: async (_args, ctx) => {
      const current = await ensureIndex(ctx.cwd);
      const draft = renderGeneratedPolicy(current.skills);
      const outputPath = getPolicyPath(ctx.cwd).replace(/\.yml$/, ".generated.yml");
      await writeFile(outputPath, draft, "utf8");
      ctx.ui.notify(`Generated ${outputPath}`, "info");
    },
  });
}

function findSkill(name: string, skills: SkillRecord[]): SkillRecord | undefined {
  return skills.find((skill) => skill.name === name);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  return `${(bytes / 1024).toFixed(1)}KB`;
}


function renderGeneratedPolicy(skills: SkillRecord[]): string {
  const lines = [
    "zeroCatalog:",
    "  enabled: false",
    "defaults:",
    "  activation: explicit",
    "candidateInjection:",
    "  maxCandidates: 5",
    "  minScore: 0.62",
    "alwaysVisible:",
    "  - pi-skill-shiori",
    "skills:",
  ];

  for (const skill of skills) {
    const triggerable = /proactively activate|triggers?:|use when/i.test(skill.description);
    lines.push(`  ${skill.name}:`);
    lines.push(`    activation: ${triggerable ? "triggerable" : "explicit"}`);
    if (triggerable) {
      lines.push("    triggers:");
      lines.push("      include:");
      lines.push(`        - ${JSON.stringify(skill.name)}`);
      lines.push("      exclude: []");
    }
    lines.push(`    path: ${JSON.stringify(relativeForYaml(skill.path))}`);
  }

  return `${lines.join("\n")}\n`;
}

function relativeForYaml(path: string): string {
  return path.replace(/\\/g, "/");
}
