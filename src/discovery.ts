import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { SkillRecord } from "./types.js";

const SKILL_FILE = "SKILL.md";

export async function discoverSkills(cwd: string): Promise<SkillRecord[]> {
  const roots = [
    join(cwd, ".pi", "skills"),
    join(cwd, ".agents", "skills"),
    join(homedir(), ".pi", "agent", "skills"),
  ];

  const records: SkillRecord[] = [];
  for (const root of roots) {
    const files = await findSkillFiles(root);
    for (const file of files) {
      records.push(await readSkillRecord(file, root));
    }
  }
  return dedupeByDiscoveryOrder(records);
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
  const block = frontmatter?.[1] ?? "";
  const name = matchYamlScalar(block, "name") ?? basename(dirname(path));
  const description = matchYamlScalar(block, "description") ?? firstParagraph(raw) ?? "No description.";
  return {
    name,
    description,
    path: resolve(path),
    source: root,
  };
}

function matchYamlScalar(block: string, key: string): string | undefined {
  const match = block.match(new RegExp(`^${key}:\s*(.+)$`, "m"));
  return match?.[1]?.trim().replace(/^['\"]|['\"]$/g, "");
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
