import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { normalizeAlwaysVisible } from "./always-visible.js";
import type { ShioriPolicy } from "./types.js";

export type PolicySourceKind = "project" | "global" | "default";

export interface LoadedPolicy {
  policy: ShioriPolicy;
  source: PolicySourceKind;
  path?: string;
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
    return { policy: projectPolicy, source: "project", path: projectPath };
  }

  const globalPath = options.globalPolicyPath ?? getGlobalPolicyPath();
  const globalPolicy = await readPolicyIfPresent(globalPath);
  if (globalPolicy) {
    return { policy: globalPolicy, source: "global", path: globalPath };
  }

  return { policy: DEFAULT_POLICY, source: "default" };
}

export function loadedPolicySignature(loaded: LoadedPolicy): string {
  return JSON.stringify({
    source: loaded.source,
    path: loaded.path ?? null,
    policy: loaded.policy,
  });
}

async function readPolicyIfPresent(path: string): Promise<ShioriPolicy | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = parse(raw) as Partial<ShioriPolicy> | undefined;
    return normalizePolicy(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function normalizePolicy(policy: Partial<ShioriPolicy> | undefined): ShioriPolicy {
  const extraRoots = (policy?.inventory?.roots ?? [])
    .map((root) => (typeof root === "string" ? root.trim() : ""))
    .filter(Boolean);

  return {
    zeroCatalog: {
      enabled: policy?.zeroCatalog?.enabled ?? DEFAULT_POLICY.zeroCatalog.enabled,
    },
    defaults: {
      activation: policy?.defaults?.activation ?? DEFAULT_POLICY.defaults.activation,
    },
    candidateInjection: {
      maxCandidates: policy?.candidateInjection?.maxCandidates ?? DEFAULT_POLICY.candidateInjection.maxCandidates,
      minScore: policy?.candidateInjection?.minScore ?? DEFAULT_POLICY.candidateInjection.minScore,
    },
    alwaysVisible: normalizeAlwaysVisible(policy?.alwaysVisible ?? DEFAULT_POLICY.alwaysVisible).allowlist,
    inventory:
      extraRoots.length > 0 || policy?.inventory?.autoRefreshOnChange === false
        ? {
            roots: extraRoots.length > 0 ? extraRoots : undefined,
            autoRefreshOnChange: policy?.inventory?.autoRefreshOnChange,
          }
        : undefined,
    skills: policy?.skills ?? DEFAULT_POLICY.skills,
  };
}
