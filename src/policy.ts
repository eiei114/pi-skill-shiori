import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { normalizeAlwaysVisible } from "./always-visible.js";
import type { ShioriPolicy, SkillActivation, SkillPolicy } from "./types.js";

export type PolicySourceKind = "project" | "global" | "default";

export interface LoadedPolicy {
  policy: ShioriPolicy;
  source: PolicySourceKind;
  path?: string;
  /** Human-readable reports for policy values that were rejected and defaulted. */
  warnings?: string[];
}

export interface PolicyLoadOptions {
  globalPolicyPath?: string;
}

export const DEFAULT_POLICY: ShioriPolicy = {
  zeroCatalog: { enabled: false },
  defaults: { activation: "explicit" },
  candidateInjection: { maxCandidates: 3, minScore: 0.62 },
  alwaysVisible: ["pi-skill-shiori"],
  skills: {},
};

const MAX_CANDIDATES_MIN = 0;
const MAX_CANDIDATES_MAX = 10;
const MIN_SCORE_MIN = 0;
const MIN_SCORE_MAX = 1;

export function getPolicyPath(cwd: string): string {
  return join(cwd, ".pi", "skill-shiori.yml");
}

export function getGlobalPolicyPath(): string {
  return join(homedir(), ".pi", "agent", "skill-shiori.yml");
}

export async function loadPolicy(cwd: string, options: PolicyLoadOptions = {}): Promise<ShioriPolicy> {
  return (await loadPolicyWithSource(cwd, options)).policy;
}

export async function loadPolicyWithSource(cwd: string, options: PolicyLoadOptions = {}): Promise<LoadedPolicy> {
  const projectPath = getPolicyPath(cwd);
  const projectPolicy = await readPolicyIfPresent(projectPath);
  if (projectPolicy) {
    return withWarnings({ policy: projectPolicy.policy, source: "project", path: projectPath }, projectPolicy.warnings);
  }

  const globalPath = options.globalPolicyPath ?? getGlobalPolicyPath();
  const globalPolicy = await readPolicyIfPresent(globalPath);
  if (globalPolicy) {
    return withWarnings({ policy: globalPolicy.policy, source: "global", path: globalPath }, globalPolicy.warnings);
  }

  return { policy: DEFAULT_POLICY, source: "default" };
}

/**
 * Identifies the *effective* policy so a reload only happens when behaviour
 * changes. Rejected raw values collapse into the same defaults, so a file edit
 * that is clamped away keeps the signature stable. Warnings are intentionally
 * excluded: they are diagnostics, not policy state.
 */
export function loadedPolicySignature(loaded: LoadedPolicy): string {
  return JSON.stringify({
    source: loaded.source,
    path: loaded.path ?? null,
    policy: loaded.policy,
  });
}

interface NormalizedPolicy {
  policy: ShioriPolicy;
  warnings: string[];
}

async function readPolicyIfPresent(path: string): Promise<NormalizedPolicy | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }

  let document: unknown;
  try {
    document = parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse Shiori policy file ${path}: ${message}`, { cause: error });
  }

  return normalizePolicy(document);
}

function withWarnings(loaded: LoadedPolicy, warnings: string[]): LoadedPolicy {
  return warnings.length > 0 ? { ...loaded, warnings } : loaded;
}

function normalizePolicy(document: unknown): NormalizedPolicy {
  const warnings: string[] = [];

  let root: Record<string, unknown> = {};
  if (!isPlainObject(document)) {
    // `parse` returns null for an empty document and a scalar for a wrongly shaped
    // one; both mean the file has no policy mapping at all.
    warnings.push(
      `policy: expected a mapping at the document root, got ${describeKind(document)}; using built-in defaults`,
    );
  } else {
    root = document;
  }

  const zeroCatalogSection = isPlainObject(root.zeroCatalog) ? root.zeroCatalog : {};
  const defaultsSection = isPlainObject(root.defaults) ? root.defaults : {};
  const candidateInjectionSection = isPlainObject(root.candidateInjection) ? root.candidateInjection : {};
  const inventorySection = isPlainObject(root.inventory) ? root.inventory : {};

  const extraRoots = Array.isArray(inventorySection.roots)
    ? inventorySection.roots
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
    : [];

  return {
    policy: {
      zeroCatalog: {
        // Existing behaviour: any truthy/falsy value is coerced, so only an
        // omitted key falls back to the default. `zeroCatalog` is outside the
        // validation scope of this change.
        enabled: (zeroCatalogSection.enabled ?? DEFAULT_POLICY.zeroCatalog.enabled) as boolean,
      },
      defaults: {
        activation: readDefaultActivation(defaultsSection, warnings),
      },
      candidateInjection: {
        maxCandidates: readMaxCandidates(candidateInjectionSection, warnings),
        minScore: readMinScore(candidateInjectionSection, warnings),
      },
      alwaysVisible: normalizeAlwaysVisible(
        Array.isArray(root.alwaysVisible)
          ? root.alwaysVisible.filter((entry): entry is string => typeof entry === "string")
          : DEFAULT_POLICY.alwaysVisible,
      ).allowlist,
      inventory:
        extraRoots.length > 0 || inventorySection.autoRefreshOnChange === false
          ? {
              roots: extraRoots.length > 0 ? extraRoots : undefined,
              autoRefreshOnChange:
                typeof inventorySection.autoRefreshOnChange === "boolean"
                  ? inventorySection.autoRefreshOnChange
                  : undefined,
            }
          : undefined,
      skills: readSkills(root, warnings),
    },
    warnings,
  };
}

function readDefaultActivation(section: Record<string, unknown>, warnings: string[]): SkillActivation {
  const fallback = DEFAULT_POLICY.defaults.activation;
  const value = section.activation;
  if (value === undefined || value === null) return fallback;
  if (isActivation(value)) return value;
  warnings.push(
    `defaults.activation: expected "explicit" or "triggerable", got ${describeValue(value)}; using ${JSON.stringify(fallback)}`,
  );
  return fallback;
}

function readMaxCandidates(section: Record<string, unknown>, warnings: string[]): number {
  const fallback = DEFAULT_POLICY.candidateInjection.maxCandidates;
  const value = section.maxCandidates;
  if (value === undefined || value === null) return fallback;
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MAX_CANDIDATES_MIN &&
    value <= MAX_CANDIDATES_MAX
  ) {
    return value;
  }
  warnings.push(
    `candidateInjection.maxCandidates: expected an integer between ${MAX_CANDIDATES_MIN} and ${MAX_CANDIDATES_MAX}, got ${describeValue(value)}; using ${fallback}`,
  );
  return fallback;
}

function readMinScore(section: Record<string, unknown>, warnings: string[]): number {
  const fallback = DEFAULT_POLICY.candidateInjection.minScore;
  const value = section.minScore;
  if (value === undefined || value === null) return fallback;
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= MIN_SCORE_MIN &&
    value <= MIN_SCORE_MAX
  ) {
    return value;
  }
  warnings.push(
    `candidateInjection.minScore: expected a finite number between ${MIN_SCORE_MIN} and ${MIN_SCORE_MAX}, got ${describeValue(value)}; using ${fallback}`,
  );
  return fallback;
}

function readSkills(root: Record<string, unknown>, warnings: string[]): Record<string, SkillPolicy> {
  const value = root.skills;
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) {
    warnings.push(
      `skills: expected a mapping of skill names to skill policies, got ${describeKind(value)}; using no skills`,
    );
    return {};
  }

  const skills: Record<string, SkillPolicy> = {};
  for (const [name, entry] of Object.entries(value)) {
    if (!isPlainObject(entry)) {
      warnings.push(`skills.${name}: expected a mapping, got ${describeKind(entry)}; dropped`);
      continue;
    }

    const activation = entry.activation;
    if (activation === undefined || activation === null) {
      skills[name] = entry as SkillPolicy;
      continue;
    }
    if (!isActivation(activation)) {
      warnings.push(
        `skills.${name}.activation: expected "explicit" or "triggerable", got ${describeValue(activation)}; ignored so defaults.activation applies`,
      );
      const { activation: _ignored, ...rest } = entry;
      skills[name] = rest as SkillPolicy;
      continue;
    }
    skills[name] = entry as SkillPolicy;
  }

  return skills;
}

function isActivation(value: unknown): value is SkillActivation {
  return value === "explicit" || value === "triggerable";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function describeKind(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "object") return "a mapping";
  if (typeof value === "string") return "a string";
  if (typeof value === "number") return "a number";
  if (typeof value === "boolean") return "a boolean";
  return typeof value;
}

function describeValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return String(value);
  return describeKind(value);
}
