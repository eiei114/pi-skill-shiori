import {
  computeInventoryFingerprint,
  discoverSkillsFromRoots,
  findDuplicates,
  resolveVaultSkillRoots,
} from "./discovery.js";
import { buildSkillIndex, type SkillIndex } from "./indexer.js";
import type { ShioriPolicy } from "./types.js";

export interface SkillInventory {
  index: SkillIndex;
  roots: string[];
  fingerprint: string;
}

export function isAutoRefreshEnabled(policy: ShioriPolicy): boolean {
  return policy.inventory?.autoRefreshOnChange !== false;
}

export async function refreshSkillInventory(
  cwd: string,
  policy: ShioriPolicy,
  previous?: SkillIndex,
): Promise<SkillInventory> {
  previous?.close?.();
  const roots = resolveVaultSkillRoots(cwd, policy);
  const [skills, fingerprint] = await Promise.all([
    discoverSkillsFromRoots(roots),
    computeInventoryFingerprint(roots),
  ]);
  const index = await buildSkillIndex(cwd, skills, policy);
  return { index, roots, fingerprint };
}

export async function isInventoryStale(
  cwd: string,
  policy: ShioriPolicy,
  fingerprint: string,
): Promise<boolean> {
  const roots = resolveVaultSkillRoots(cwd, policy);
  const current = await computeInventoryFingerprint(roots);
  return current !== fingerprint;
}

export function countSkillsByRoot(skills: SkillIndex["skills"], roots: string[]): Map<string, number> {
  const counts = new Map(roots.map((root) => [root, 0]));
  for (const skill of skills) {
    counts.set(skill.source, (counts.get(skill.source) ?? 0) + 1);
  }
  return counts;
}

export function formatInventoryRoots(roots: string[], skills: SkillIndex["skills"]): string[] {
  const counts = countSkillsByRoot(skills, roots);
  return roots.map((root) => `${root} (${counts.get(root) ?? 0} skills)`);
}

export { findDuplicates };
