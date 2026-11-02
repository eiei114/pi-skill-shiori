import { readFile } from "node:fs/promises";
import type { SkillCandidate } from "./types.js";

export interface LoadedSkill {
  candidate: SkillCandidate;
  content: string;
}

export function loadSkillContent(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export async function loadRecommendedSkills(candidates: SkillCandidate[]): Promise<LoadedSkill[]> {
  const loaded: LoadedSkill[] = [];
  for (const candidate of candidates) {
    const content = await loadSkillContent(candidate.skill.path);
    loaded.push({ candidate, content });
  }
  return loaded;
}
