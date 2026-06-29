import { normalizeAlwaysVisible } from "./always-visible.js";
import { formatReasonBadgeSuffix } from "./recommendation-reason.js";
import type { SkillCandidate, SkillRecord, SuppressionStatus } from "./types.js";

export interface CatalogSuppressionResult {
  systemPrompt: string;
  status: SuppressionStatus;
}

export interface SuppressCatalogOptions {
  alwaysVisible: string[];
  skills: SkillRecord[];
}

const COMPACT_DESCRIPTION_LIMIT = 120;

const CATALOG_BOUNDARY_PATTERNS: Array<{ pattern: RegExp; format: "xml" | "markdown" }> = [
  {
    pattern:
      /\r?\n\r?\nThe following skills provide specialized instructions for specific tasks\.\r?\n[\s\S]*?\r?\n<available_skills>[\s\S]*?\r?\n<\/available_skills>/,
    format: "xml",
  },
  {
    pattern: /(^|\r?\n)<available_skills>[\s\S]*?<\/available_skills>/i,
    format: "xml",
  },
  {
    pattern: /(^|\r?\n)#{2,4}\s*Available skills\b[\s\S]*?(?=\r?\n#{2,4}\s*How to use skills\b)/i,
    format: "markdown",
  },
  {
    pattern: /(^|\r?\n)#{2,4}\s*Available skills\b[\s\S]*?(?=\r?\n#{2,4}\s*Fallback\b)/i,
    format: "markdown",
  },
];

export function formatCandidateInjection(candidates: SkillCandidate[]): string {
  if (candidates.length === 0) return "";
  const lines = ["Relevant skills:"];
  for (const candidate of candidates) {
    const desc = compactDescription(candidate.skill.description, COMPACT_DESCRIPTION_LIMIT);
    lines.push(
      `- ${candidate.skill.name}${formatReasonBadgeSuffix(candidate.reason)}: ${desc} Load: shiori_load_skill({ skill: "${candidate.skill.name}" })`,
    );
  }
  return lines.join("\n");
}

export function formatRecommendKickoffMessage(
  query: string,
  loaded: Array<{ candidate: SkillCandidate; content: string }>,
): string {
  const lines = [query.trim(), ""];

  if (loaded.length === 0) {
    lines.push(
      "---",
      "Pi Skill Shiori: no matching skills for this task.",
      "Continue without a dedicated skill, or refine the task description and run /shiori:recommend again.",
    );
    return lines.join("\n");
  }

  const names = loaded.map(({ candidate }) => candidate.skill.name).join(", ");
  lines.push(
    "---",
    `Pi Skill Shiori: pre-loaded ${loaded.length} skill(s): ${names}`,
    "Follow the skill instructions below and continue with the task above.",
    "",
  );

  for (const { candidate, content } of loaded) {
    lines.push(
      `### Skill: ${candidate.skill.name}${formatReasonBadgeSuffix(candidate.reason)}`,
      `Score: ${candidate.score.toFixed(2)}`,
      `Path: ${candidate.skill.path}`,
      "",
      content.trim(),
      "",
    );
  }

  return lines.join("\n");
}

export function formatLoadedSkillsSummary(loaded: Array<{ candidate: SkillCandidate; content: string }>): string {
  if (loaded.length === 0) return "";
  const lines = [`Pre-loaded ${loaded.length} skill(s):`];
  for (const { candidate } of loaded) {
    const desc = compactDescription(candidate.skill.description, COMPACT_DESCRIPTION_LIMIT);
    lines.push(`- ${candidate.skill.name}${formatReasonBadgeSuffix(candidate.reason)} (${candidate.score.toFixed(2)}): ${desc}`);
  }
  return lines.join("\n");
}

export function formatCandidateDetail(candidate: SkillCandidate): string {
  return [
    `${candidate.skill.name}${formatReasonBadgeSuffix(candidate.reason)}`,
    `Description: ${candidate.skill.description}`,
    `Score: ${candidate.score.toFixed(2)}`,
    `Path: ${candidate.skill.path}`,
    `Load: shiori_load_skill({ skill: "${candidate.skill.name}" })`,
  ].join("\n");
}

export function compactDescription(description: string, maxChars = COMPACT_DESCRIPTION_LIMIT): string {
  const singleLine = description.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxChars) return singleLine;
  return `${singleLine.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

export function suppressSkillCatalog(
  systemPrompt: string,
  options?: SuppressCatalogOptions,
): CatalogSuppressionResult {
  for (const { pattern, format } of CATALOG_BOUNDARY_PATTERNS) {
    const match = systemPrompt.match(pattern);
    if (!match) continue;
    const replacement = buildFilteredCatalogReplacement(match[0], format, options);
    return {
      systemPrompt: systemPrompt.replace(pattern, replacement),
      status: "suppressed",
    };
  }

  if (!hasSkillCatalogSignal(systemPrompt)) {
    return { systemPrompt, status: "not-needed" };
  }

  return { systemPrompt, status: "failed-pattern-not-found" };
}

function buildFilteredCatalogReplacement(
  catalogSection: string,
  format: "xml" | "markdown",
  options?: SuppressCatalogOptions,
): string {
  if (!options) {
    return [
      "### Available skills",
      "Normal Skill Catalog hidden by Pi Skill Shiori.",
      "Use injected candidates or shiori_load_skill when relevant.",
      "Explicit /skill:name invocation remains allowed.",
    ].join("\n");
  }

  const { allowlist } = normalizeAlwaysVisible(options.alwaysVisible);
  const allowSet = new Set(allowlist);
  const skillsByName = new Map(options.skills.map((skill) => [skill.name, skill]));

  if (format === "xml") {
    return buildFilteredXmlCatalog(catalogSection, allowSet, allowlist, skillsByName);
  }

  return buildFilteredMarkdownCatalog(catalogSection, allowSet, allowlist, skillsByName);
}

function buildFilteredXmlCatalog(
  catalogSection: string,
  allowSet: Set<string>,
  allowlist: string[],
  skillsByName: Map<string, SkillRecord>,
): string {
  const prefix = extractXmlCatalogPrefix(catalogSection);
  const keptBlocks: string[] = [];
  const keptNames = new Set<string>();

  for (const block of extractXmlSkillBlocks(catalogSection)) {
    const name = parseXmlSkillName(block);
    if (!name || !allowSet.has(name)) continue;
    keptBlocks.push(block);
    keptNames.add(name);
  }

  for (const name of allowlist) {
    if (keptNames.has(name)) continue;
    const record = skillsByName.get(name);
    if (!record) continue;
    keptBlocks.push(formatXmlSkillBlock(record));
    keptNames.add(name);
  }

  if (keptBlocks.length === 0) {
    return buildHiddenCatalogStub();
  }

  const lines = [...prefix, "<available_skills>"];
  for (const block of keptBlocks) {
    lines.push(block);
  }
  lines.push("</available_skills>");
  return lines.join("\n");
}

function buildFilteredMarkdownCatalog(
  catalogSection: string,
  allowSet: Set<string>,
  allowlist: string[],
  skillsByName: Map<string, SkillRecord>,
): string {
  const headerMatch = catalogSection.match(/(^|\r?\n)(#{2,4}\s*Available skills\b[^\n]*)/i);
  const header = headerMatch?.[2] ?? "### Available skills";
  const keptLines: string[] = [];
  const keptNames = new Set<string>();

  for (const line of catalogSection.split(/\r?\n/)) {
    const match = line.match(/^\s*[-*]\s+\*\*([^*]+)\*\*:\s*(.*)$/);
    if (!match) continue;
    const name = match[1].trim();
    if (!allowSet.has(name)) continue;
    keptLines.push(`- **${name}**: ${match[2].trim()}`);
    keptNames.add(name);
  }

  for (const name of allowlist) {
    if (keptNames.has(name)) continue;
    const record = skillsByName.get(name);
    if (!record) continue;
    keptLines.push(`- **${record.name}**: ${compactDescription(record.description, 240)}`);
    keptNames.add(name);
  }

  if (keptLines.length === 0) {
    return buildHiddenCatalogStub();
  }

  return [`${header}`, "Pi Skill Shiori: only always-visible skills remain in the Skill Catalog.", ...keptLines].join(
    "\n",
  );
}

function buildHiddenCatalogStub(): string {
  return [
    "### Available skills",
    "Normal Skill Catalog hidden by Pi Skill Shiori.",
    "Use injected candidates or shiori_load_skill when relevant.",
    "Explicit /skill:name invocation remains allowed.",
  ].join("\n");
}

function extractXmlCatalogPrefix(catalogSection: string): string[] {
  const marker = catalogSection.search(/<available_skills>/i);
  if (marker <= 0) return [];
  return catalogSection.slice(0, marker).replace(/\r?\n$/, "").split(/\r?\n/).filter(Boolean);
}

function extractXmlSkillBlocks(catalogSection: string): string[] {
  return [...catalogSection.matchAll(/<skill>[\s\S]*?<\/skill>/gi)].map((match) => match[0]);
}

function parseXmlSkillName(block: string): string | undefined {
  const match = block.match(/<name>([\s\S]*?)<\/name>/i);
  if (!match) return undefined;
  return unescapeXml(match[1].trim());
}

function formatXmlSkillBlock(skill: SkillRecord): string {
  return [
    "  <skill>",
    `    <name>${escapeXml(skill.name)}</name>`,
    `    <description>${escapeXml(skill.description)}</description>`,
    `    <location>${escapeXml(skill.path)}</location>`,
    "  </skill>",
  ].join("\n");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(value: string): string {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function hasSkillCatalogSignal(systemPrompt: string): boolean {
  return /<\/?available_skills>|The following skills provide specialized instructions|#{2,4}\s*Available skills\b/i.test(
    systemPrompt,
  );
}
