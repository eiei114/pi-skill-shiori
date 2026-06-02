import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { readFile, writeFile } from "node:fs/promises";
import { discoverSkills, findDuplicates } from "./discovery.js";
import { buildSkillIndex, type SkillIndex } from "./indexer.js";
import { createStats } from "./metrics.js";
import { getPolicyPath, loadPolicy } from "./policy.js";
import { formatCandidateDetail, formatCandidateInjection, suppressSkillCatalog } from "./prompt.js";
import { retrieveCandidates } from "./retrieval.js";
import type { SkillRecord } from "./types.js";

interface ShioriLoadDetails {
  skill: string;
  path: string;
  bytes: number;
  loadedAt: string;
}

const SHIORI_CODE_MARKER = "prompt-boundary-v3";

export default function piSkillShiori(pi: ExtensionAPI) {
  let index: SkillIndex | undefined;
  const stats = createStats();

  async function reload(cwd: string): Promise<SkillIndex> {
    const [policy, skills] = await Promise.all([loadPolicy(cwd), discoverSkills(cwd)]);
    index?.close?.();
    index = await buildSkillIndex(cwd, skills, policy);
    stats.inventoryCount = skills.length;
    stats.duplicateCount = findDuplicates(skills).size;
    stats.lastReloadAt = index.builtAt;
    stats.retrievalBackend = index.retrievalBackend;
    stats.suppressionStatus = policy.zeroCatalog.enabled ? "not-needed" : "disabled";
    return index;
  }

  async function ensureIndex(cwd: string): Promise<SkillIndex> {
    return index ?? reload(cwd);
  }

  pi.on("session_start", async (_event, ctx) => {
    await reload(ctx.cwd);
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

    const suppression = suppressSkillCatalog(event.systemPrompt);
    stats.suppressionStatus = suppression.status;
    if (suppression.status === "failed-pattern-not-found") {
      ctx.ui.notify("Pi Skill Shiori: Skill Catalog suppression pattern not found; leaving system prompt unchanged.", "warning");
    }

    const candidates = retrieveCandidates(event.prompt, current.skills, current.policy, current);
    if (candidates.length === 0) stats.zeroCandidateCount += 1;
    else stats.candidateHitCount += 1;

    const injection = formatCandidateInjection(candidates);
    const candidateSection = injection ? `\n\n## Pi Skill Shiori Candidates\n\n${injection}\n` : "";

    return {
      systemPrompt: `${suppression.systemPrompt}${candidateSection}`,
    };
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
      ctx.ui.notify(
        [
          "Pi Skill Shiori doctor",
          `policy: ${getPolicyPath(ctx.cwd)}`,
          `zeroCatalog: ${current.policy.zeroCatalog.enabled ? "enabled" : "disabled"}`,
          `skills: ${current.skills.length}`,
          `duplicates: ${duplicates.size}`,
          `alwaysVisible: ${current.policy.alwaysVisible.join(", ") || "none"}`,
          `retrievalBackend: ${current.retrievalBackend}`,
          `suppression: ${stats.suppressionStatus}`,
          `code: ${SHIORI_CODE_MARKER}`,
          `builtAt: ${current.builtAt}`,
        ].join("\n"),
        duplicates.size > 0 || stats.suppressionStatus === "failed-pattern-not-found" ? "warning" : "info",
      );
    },
  });

  pi.registerCommand("shiori:reload", {
    description: "Rebuild Pi Skill Shiori inventory and optional Pi runtime resources",
    handler: async (args, ctx) => {
      await reload(ctx.cwd);
      if (args.includes("--runtime")) {
        await ctx.reload();
        return;
      }
      ctx.ui.notify(`Pi Skill Shiori reloaded: ${stats.inventoryCount} skills (${stats.retrievalBackend})`, "info");
    },
  });

  pi.registerCommand("shiori:recommend", {
    description: "Recommend Agent Skills for a natural-language task",
    handler: async (args, ctx) => {
      const current = await ensureIndex(ctx.cwd);
      let query = args.trim();

      if (!query) {
        if (!ctx.hasUI) {
          ctx.ui.notify(
            "Provide a task description: /shiori:recommend <what you want to do>",
            "warning",
          );
          return;
        }
        const input = await ctx.ui.input(
          "What do you want help with?",
          "Describe your task in natural language…",
        );
        if (!input?.trim()) {
          ctx.ui.notify("Recommendation cancelled.", "info");
          return;
        }
        query = input.trim();
      }

      const candidates = retrieveCandidates(query, current.skills, current.policy, current);
      const summary = formatCandidateInjection(candidates);
      if (!summary) {
        ctx.ui.notify("No matching skills for that request.", "warning");
        return;
      }

      ctx.ui.notify(summary, "info");

      if (candidates.length === 0 || !ctx.hasUI) {
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
    "  maxCandidates: 3",
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
