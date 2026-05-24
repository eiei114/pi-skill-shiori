import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { RetrievalBackend, ShioriPolicy, SkillRecord } from "./types.js";

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
    db.exec("CREATE VIRTUAL TABLE skill_fts USING fts5(name, description, triggers, path)");
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

function buildFtsQuery(query: string): string {
  const terms = query.match(/[A-Za-z0-9_-]{2,}/g) ?? [];
  const uniqueTerms = [...new Set(terms.map((term) => term.toLowerCase()))].slice(0, 8);
  return uniqueTerms.map((term) => `${escapeFtsTerm(term)}*`).join(" OR ");
}

function escapeFtsTerm(term: string): string {
  return term.replace(/[^A-Za-z0-9_-]/g, "");
}
