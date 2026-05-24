import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import type { ShioriPolicy } from "./types.js";

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

export async function loadPolicy(cwd: string): Promise<ShioriPolicy> {
  try {
    const raw = await readFile(getPolicyPath(cwd), "utf8");
    const parsed = parse(raw) as Partial<ShioriPolicy> | undefined;
    return normalizePolicy(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return DEFAULT_POLICY;
    }
    throw error;
  }
}

function normalizePolicy(policy: Partial<ShioriPolicy> | undefined): ShioriPolicy {
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
    alwaysVisible: policy?.alwaysVisible ?? DEFAULT_POLICY.alwaysVisible,
    skills: policy?.skills ?? DEFAULT_POLICY.skills,
  };
}
