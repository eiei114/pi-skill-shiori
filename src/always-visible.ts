import type { SkillRecord } from "./types.js";

export interface AlwaysVisibleDiagnostics {
  missing: string[];
  duplicates: string[];
  resolved: string[];
}

export function normalizeAlwaysVisible(alwaysVisible: string[] | undefined): {
  allowlist: string[];
  duplicates: string[];
} {
  const duplicates: string[] = [];
  const seen = new Set<string>();
  const allowlist: string[] = [];

  for (const entry of alwaysVisible ?? []) {
    const name = entry.trim();
    if (!name) continue;
    if (seen.has(name)) {
      if (!duplicates.includes(name)) duplicates.push(name);
      continue;
    }
    seen.add(name);
    allowlist.push(name);
  }

  return { allowlist, duplicates };
}

export function evaluateAlwaysVisible(
  alwaysVisible: string[] | undefined,
  skills: SkillRecord[],
): AlwaysVisibleDiagnostics {
  const { allowlist, duplicates } = normalizeAlwaysVisible(alwaysVisible);
  const inventory = new Set(skills.map((skill) => skill.name));
  const missing = allowlist.filter((name) => !inventory.has(name));
  const resolved = allowlist.filter((name) => inventory.has(name));
  return { missing, duplicates, resolved };
}

export function formatAlwaysVisibleDiagnostics(diagnostics: AlwaysVisibleDiagnostics): string[] {
  const lines: string[] = [];
  if (diagnostics.resolved.length > 0) {
    lines.push(`alwaysVisible resolved: ${diagnostics.resolved.join(", ")}`);
  }
  if (diagnostics.missing.length > 0) {
    lines.push(`alwaysVisible missing: ${diagnostics.missing.join(", ")}`);
  }
  if (diagnostics.duplicates.length > 0) {
    lines.push(`alwaysVisible duplicates: ${diagnostics.duplicates.join(", ")}`);
  }
  return lines;
}
