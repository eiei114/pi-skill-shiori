import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, join } from "node:path";
import type { RetrievalBackend, ShioriPolicy, SkillRecord } from "./types.js";

const INDEX_FILE_PATTERN = /^index-\d+-\d+\.sqlite(?:-(?:wal|shm|journal))?$/;

/**
 * Index databases are written with a per-process name, so every rebuild adds a
 * file. Prune older ones after a grace window: long enough that a concurrent
 * process keeps its database, short enough that a busy vault does not grow
 * without bound.
 */
export const DEFAULT_INDEX_GRACE_MS = 60 * 60 * 1000;

export interface PruneIndexOptions {
  /** File name to keep, usually the database this process just opened. */
  keep?: string;
  /** Files newer than this window are left alone. */
  graceMs?: number;
  /** Clock override for tests. */
  now?: number;
}

/**
 * Best-effort cleanup of stale index databases. Locked files (a live process on
 * Windows) and unreadable entries are skipped instead of failing the build.
 */
export async function pruneStaleIndexFiles(cacheDir: string, options: PruneIndexOptions = {}): Promise<string[]> {
  const graceMs = options.graceMs ?? DEFAULT_INDEX_GRACE_MS;
  const now = options.now ?? Date.now();
  const removed: string[] = [];

  let entries: string[];
  try {
    entries = await readdir(cacheDir);
  } catch {
    return removed;
  }

  for (const entry of entries) {
    if (!INDEX_FILE_PATTERN.test(entry)) continue;
    if (options.keep && entry === options.keep) continue;

    const target = join(cacheDir, entry);
    try {
      const info = await stat(target);
      if (!info.isFile()) continue;
      if (now - info.mtimeMs < graceMs) continue;
      await unlink(target);
      removed.push(entry);
    } catch {
      // Locked (a live process owns it) or already gone: leave it for next time.
    }
  }

  return removed;
}

export interface SkillIndex {
  skills: SkillRecord[];
  policy: ShioriPolicy;
  builtAt: string;
  retrievalBackend: RetrievalBackend;
  search(query: string, limit: number): SkillRecord[];
  close(): void;
}

export async function buildSkillIndex(cwd: string, skills: SkillRecord[], policy: ShioriPolicy): Promise<SkillIndex> {
  const builtAt = new Date().toISOString();
  const byName = new Map(skills.map((skill) => [skill.name, skill]));

  try {
    const require = createRequire(import.meta.url);
    const sqlite = require("node:sqlite") as typeof import("node:sqlite");
    const cacheDir = join(cwd, ".pi", "cache", "skill-shiori");
    const dbPath = join(cacheDir, `index-${process.pid}-${Date.now()}.sqlite`);
    await mkdir(cacheDir, { recursive: true });

    const db = new sqlite.DatabaseSync(dbPath);
    await pruneStaleIndexFiles(cacheDir, { keep: basename(dbPath) });
    db.exec(
      "CREATE VIRTUAL TABLE skill_fts USING fts5(name, description, triggers, path, tokenize='unicode61 remove_diacritics 2')",
    );
    const insert = db.prepare("INSERT INTO skill_fts(name, description, triggers, path) VALUES (?, ?, ?, ?)");
    for (const skill of skills) {
      const triggers = [
        ...(policy.skills[skill.name]?.triggers?.include ?? []),
        ...(policy.skills[skill.name]?.triggers?.exclude ?? []),
      ].join(" ");
      insert.run(skill.name, skill.description, triggers, skill.path);
    }

    return {
      skills,
      policy,
      builtAt,
      retrievalBackend: "sqlite-fts",
      search(query: string, limit: number): SkillRecord[] {
        const ftsQuery = buildFtsQuery(query);
        if (!ftsQuery) return [];
        try {
          const rows = db
            .prepare("SELECT name FROM skill_fts WHERE skill_fts MATCH ? LIMIT ?")
            .all(ftsQuery, limit) as Array<{ name: string }>;
          return rows.map((row) => byName.get(row.name)).filter((skill): skill is SkillRecord => Boolean(skill));
        } catch {
          return [];
        }
      },
      close(): void {
        db.close();
      },
    };
  } catch {
    return {
      skills,
      policy,
      builtAt,
      retrievalBackend: "token-match",
      search(): SkillRecord[] {
        return [];
      },
      close(): void {},
    };
  }
}

export function buildFtsQuery(query: string): string {
  const terms = extractSearchTerms(query);
  if (terms.length === 0) return "";
  return terms.map((term) => `${escapeFtsTerm(term)}*`).join(" OR ");
}

export function extractSearchTerms(query: string): string[] {
  const terms = new Set<string>();
  const chunks = query.split(/[^\p{L}\p{N}_-]+/u).filter(Boolean);

  for (const chunk of chunks) {
    if (chunk.length < 2) continue;

    const isJapanese =
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(chunk) &&
      !/[A-Za-z]/u.test(chunk);

    if (isJapanese) {
      const segments = chunk.split(/(?:の|を|に|で|と|が|は|して|から|へ|も|など|まわり)/u);
      for (const segment of segments) {
        if (segment.length >= 2) terms.add(segment.toLocaleLowerCase());
      }
      if (terms.size === 0) terms.add(chunk.toLocaleLowerCase());
      continue;
    }

    terms.add(chunk.toLocaleLowerCase());
  }

  return [...terms].slice(0, 8);
}

function escapeFtsTerm(term: string): string {
  return term.replace(/["'*():^]/g, "");
}
