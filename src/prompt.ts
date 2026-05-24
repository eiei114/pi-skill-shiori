import type { SkillCandidate, SuppressionStatus } from "./types.js";

interface CandidateFormatOptions {
  verbose?: boolean;
}

export interface CatalogSuppressionResult {
  systemPrompt: string;
  status: SuppressionStatus;
}

const COMPACT_DESCRIPTION_LIMIT = 120;

export function formatCandidateInjection(candidates: SkillCandidate[], options: CandidateFormatOptions = {}): string {
  if (candidates.length === 0) return "";
  const lines = ["Relevant skills:"];
  for (const candidate of candidates) {
    const desc = compactDescription(candidate.skill.description, COMPACT_DESCRIPTION_LIMIT);
    if (options.verbose) {
      lines.push(`- ${candidate.skill.name}`);
      lines.push(`  desc: ${candidate.skill.description}`);
      lines.push(`  score: ${candidate.score.toFixed(2)}`);
      lines.push(`  why: ${candidate.why}`);
      lines.push(`  path: ${candidate.skill.path}`);
      lines.push(`  load: shiori_load_skill({ skill: "${candidate.skill.name}" })`);
    } else {
      lines.push(
        `- ${candidate.skill.name}: ${desc} Reason: ${candidate.why}. Load: shiori_load_skill({ skill: "${candidate.skill.name}" })`,
      );
    }
  }
  return lines.join("\n");
}

export function compactDescription(description: string, maxChars = COMPACT_DESCRIPTION_LIMIT): string {
  const singleLine = description.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxChars) return singleLine;
  return `${singleLine.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

export function suppressSkillCatalog(systemPrompt: string): CatalogSuppressionResult {
  const replacement = [
    "### Available skills",
    "Normal Skill Catalog hidden by Pi Skill Shiori.",
    "Use injected candidates or shiori_load_skill when relevant.",
    "Explicit /skill:name invocation remains allowed.",
  ].join("\n");

  const patterns = [
    /\r?\n\r?\nThe following skills provide specialized instructions for specific tasks\.\r?\n[\s\S]*?\r?\n<available_skills>[\s\S]*?\r?\n<\/available_skills>/,
    /(^|\r?\n)<available_skills>[\s\S]*?<\/available_skills>/i,
    /(^|\r?\n)#{2,4}\s*Available skills\b[\s\S]*?(?=\r?\n#{2,4}\s*How to use skills\b)/i,
    /(^|\r?\n)#{2,4}\s*Available skills\b[\s\S]*?(?=\r?\n#{2,4}\s*Fallback\b)/i,
  ];
  for (const pattern of patterns) {
    if (!pattern.test(systemPrompt)) continue;
    return {
      systemPrompt: systemPrompt.replace(pattern, `${replacement}\n`),
      status: "suppressed",
    };
  }

  if (!hasSkillCatalogSignal(systemPrompt)) {
    return { systemPrompt, status: "not-needed" };
  }

  return { systemPrompt, status: "failed-pattern-not-found" };
}

function hasSkillCatalogSignal(systemPrompt: string): boolean {
  return /<\/?available_skills>|The following skills provide specialized instructions|#{2,4}\s*Available skills\b/i.test(
    systemPrompt,
  );
}
