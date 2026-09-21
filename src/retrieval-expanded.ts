import { buildRetrievalQueries } from "./query.js";
import { compareCandidates, excludedSkillNames, retrieveCandidates } from "./retrieval.js";
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
  // Apply the original query's excludes across the merged set. A derived
  // single-token variant can drop the context that made an exclude match
  // ("do not use auth" becomes "auth"), which would otherwise let an excluded
  // skill back in once variants are merged.
  const excluded = excludedSkillNames(query, skills, policy);

  for (const variant of buildRetrievalQueries(query)) {
    for (const candidate of retrieveCandidates(variant, skills, policy, index)) {
      if (excluded.has(candidate.skill.name)) continue;
      const previous = byName.get(candidate.skill.name);
      byName.set(candidate.skill.name, preferExpandedCandidate(previous, candidate));
    }
  }

  return [...byName.values()].sort(compareCandidates).slice(0, max);
}

/** Keep trigger badges when expanded query variants also score the description higher. */
function preferExpandedCandidate(
  previous: SkillCandidate | undefined,
  candidate: SkillCandidate,
): SkillCandidate {
  if (!previous) return candidate;
  if (previous.reason === "trigger") return previous;
  if (candidate.reason === "trigger") return candidate;
  return candidate.score > previous.score ? candidate : previous;
}
