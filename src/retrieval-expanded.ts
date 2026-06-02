import { buildRetrievalQueries } from "./query.js";
import { retrieveCandidates } from "./retrieval.js";
import type { ShioriPolicy, SkillCandidate, SkillRecord } from "./types.js";

interface RetrievalIndex {
  search(query: string, limit: number): SkillRecord[];
}

export function retrieveCandidatesExpanded(
  query: string,
  skills: SkillRecord[],
  policy: ShioriPolicy,
  index?: RetrievalIndex,
): SkillCandidate[] {
  const byName = new Map<string, SkillCandidate>();
  const max = policy.candidateInjection.maxCandidates;

  for (const variant of buildRetrievalQueries(query)) {
    for (const candidate of retrieveCandidates(variant, skills, policy, index)) {
      const previous = byName.get(candidate.skill.name);
      if (!previous || candidate.score > previous.score) {
        byName.set(candidate.skill.name, candidate);
      }
    }
  }

  return [...byName.values()]
    .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
    .slice(0, max);
}
