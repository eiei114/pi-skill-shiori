import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { ShioriPolicy, SkillRecord } from "./types.js";

const SKILL_FILE = "SKILL.md";

/** Frontmatter fence: a `---` line with optional trailing spaces or tabs. */
const FRONTMATTER_FENCE = /^---[ \t]*$/;

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  /** Markdown after the closing fence, with the frontmatter block removed. */
  body: string;
}

/**
 * Strip a leading UTF-8 BOM and normalise CRLF/CR line endings to LF. Windows
 * editors and PowerShell 5 `Out-File`/`Set-Content` produce both, and a stray
 * `\r` or BOM otherwise leaks into skill names and descriptions.
 */
export function normalizeSkillText(raw: string): string {
  return raw.replace(/\uFEFF/g, "").replace(/\r\n?/g, "\n");
}

/**
 * Split `SKILL.md` content into frontmatter metadata and the remaining body.
 * Never throws: malformed YAML drops the metadata and keeps the file body, so
 * discovery can still fall back to the directory name and first paragraph.
 */
export function parseSkillFrontmatter(raw: string): SkillFrontmatter {
  const text = normalizeSkillText(raw);
  const lines = text.split("\n");
  const opening = lines[0];

  if (opening === undefined || !FRONTMATTER_FENCE.test(opening)) {
    return { body: text };
  }

  let closing = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (FRONTMATTER_FENCE.test(lines[index] ?? "")) {
      closing = index;
      break;
    }
  }

  // An unterminated frontmatter block is treated as plain body text.
  if (closing === -1) return { body: text };

  const yamlText = lines.slice(1, closing).join("\n");
  const result: SkillFrontmatter = { body: lines.slice(closing + 1).join("\n") };

  // An empty frontmatter block is valid and simply carries no metadata.
  if (!yamlText.trim()) return result;

  try {
    const meta: unknown = parseYaml(yamlText);
    if (meta && typeof meta === "object") {
      const record = meta as Record<string, unknown>;
      if (typeof record.name === "string" && record.name.trim()) {
        result.name = record.name.trim();
      }
      if (typeof record.description === "string" && record.description.trim()) {
        result.description = record.description.trim();
      }
    }
  } catch {
    // Malformed YAML: keep the body, fall back to directory name and paragraph.
  }

  return result;
}

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
  await walk(root, result, new Set<string>());
  return result;
}

async function walk(dir: string, result: string[], visited: Set<string>): Promise<void> {
  let canonicalDir: string;
  try {
    canonicalDir = await realpath(dir);
  } catch {
    return;
  }
  if (visited.has(canonicalDir)) return;
  visited.add(canonicalDir);

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, result, visited);
    } else if (entry.isSymbolicLink()) {
      try {
        const target = await stat(fullPath);
        if (target.isDirectory()) {
          await walk(fullPath, result, visited);
        }
      } catch {
        // Ignore broken symlinks.
      }
    } else if (entry.isFile() && entry.name === SKILL_FILE) {
      result.push(fullPath);
    }
  }
}

async function readSkillRecord(path: string, root: string): Promise<SkillRecord> {
  const raw = await readFile(path, "utf8");
  const parsed = parseSkillFrontmatter(raw);

  return {
    name: parsed.name ?? basename(dirname(path)),
    description: parsed.description ?? firstParagraph(parsed.body) ?? "No description.",
    path: resolve(path),
    source: root,
  };
}

function firstParagraph(body: string): string | undefined {
  return normalizeSkillText(body)
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
