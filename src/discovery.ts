import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { ShioriPolicy, SkillRecord } from "./types.js";

const SKILL_FILE = "SKILL.md";

/** Project-local skill roots scanned on every vault-wide inventory build. */
export const VAULT_LOCAL_SKILL_ROOT_SEGMENTS = [".pi/skills", ".agents/skills"] as const;

/** User-global Pi agent skills root (lowest discovery precedence). */
export const GLOBAL_AGENT_SKILL_ROOT_SEGMENTS = ".pi/agent/skills";

export function resolveVaultSkillRoots(cwd: string, policy?: Pick<ShioriPolicy, "inventory">): string[] {
  const roots = [
    join(cwd, ".pi", "skills"),
    join(cwd, ".agents", "skills"),
    join(homedir(), ".pi", "agent", "skills"),
  ];

  for (const entry of policy?.inventory?.roots ?? []) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const resolved = isAbsolute(trimmed) ? resolve(trimmed) : resolve(cwd, trimmed);
    if (!roots.includes(resolved)) {
      roots.push(resolved);
    }
  }

  return roots;
}

export async function discoverSkills(cwd: string, policy?: ShioriPolicy): Promise<SkillRecord[]> {
  const roots = resolveVaultSkillRoots(cwd, policy);
  return discoverSkillsFromRoots(roots);
}

export async function discoverSkillsFromRoots(roots: string[]): Promise<SkillRecord[]> {
  const records: SkillRecord[] = [];
  for (const root of roots) {
    const files = await findSkillFiles(root);
    for (const file of files) {
      records.push(await readSkillRecord(file, root));
    }
  }
  return dedupeByDiscoveryOrder(records);
}

export async function computeInventoryFingerprint(roots: string[]): Promise<string> {
  const parts: string[] = [];
  for (const root of roots) {
    const files = await findSkillFiles(root);
    parts.push(`${root}:${files.sort().join(",")}`);
  }
  return parts.join("|");
}

export function findDuplicates(records: SkillRecord[]): Map<string, SkillRecord[]> {
  const groups = new Map<string, SkillRecord[]>();
  for (const record of records) {
    const current = groups.get(record.name) ?? [];
    current.push(record);
    groups.set(record.name, current);
  }
  return new Map([...groups].filter(([, items]) => items.length > 1));
}

async function findSkillFiles(root: string): Promise<string[]> {
  try {
    const info = await stat(root);
    if (!info.isDirectory()) return [];
  } catch {
    return [];
  }

  const result: string[] = [];
  await walk(root, result);
  return result;
}

async function walk(dir: string, result: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, result);
    } else if (entry.isFile() && entry.name === SKILL_FILE) {
      result.push(fullPath);
    }
  }
}

async function readSkillRecord(path: string, root: string): Promise<SkillRecord> {
  const raw = await readFile(path, "utf8");
  const frontmatter = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  let name = basename(dirname(path));
  let description: string | undefined;

  if (frontmatter?.[1]) {
    try {
      const meta = parseYaml(frontmatter[1]) as Record<string, unknown> | null;
      if (meta && typeof meta === "object") {
        if (typeof meta.name === "string" && meta.name.trim()) {
          name = meta.name.trim();
        }
        if (typeof meta.description === "string" && meta.description.trim()) {
          description = meta.description.trim();
        }
      }
    } catch {
      // Fall back to body text when frontmatter is malformed.
    }
  }

  if (!description) {
    description = firstParagraph(raw) ?? "No description.";
  }

  return {
    name,
    description,
    path: resolve(path),
    source: root,
  };
}

function firstParagraph(raw: string): string | undefined {
  return raw
    .replace(/^---\s*\n[\s\S]*?\n---/, "")
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .find(Boolean);
}

function dedupeByDiscoveryOrder(records: SkillRecord[]): SkillRecord[] {
  const seen = new Set<string>();
  const result: SkillRecord[] = [];
  for (const record of records) {
    if (seen.has(record.name)) continue;
    seen.add(record.name);
    result.push(record);
  }
  return result;
}
