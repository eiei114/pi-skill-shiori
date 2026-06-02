import { readFile } from "node:fs/promises";
import type { SkillCandidate } from "./types.js";

export interface LoadedSkill {
  candidate: SkillCandidate;
  content: string;
}

export async function loadRecommendedSkills(candidates: SkillCandidate[]): Promise<LoadedSkill[]> {
  const loaded: LoadedSkill[] = [];
  for (const candidate of candidates) {
    const content = await readFile(candidate.skill.path, "utf8");
    loaded.push({ candidate, content });
  }
  return loaded;
}
