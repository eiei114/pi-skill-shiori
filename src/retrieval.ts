import { attachRecommendationReason } from "./recommendation-reason.js";
import type { ShioriPolicy, SkillCandidate, SkillRecord } from "./types.js";

interface RetrievalIndex {
  search(query: string, limit: number): SkillRecord[];
}

export function retrieveCandidates(
  query: string,
  skills: SkillRecord[],
  policy: ShioriPolicy,
  index?: RetrievalIndex,
): SkillCandidate[] {
  const normalizedQuery = normalize(query);
  const candidatesByName = new Map<string, SkillCandidate>();
  const triggerableSkills = skills.filter(
    (skill) => (policy.skills[skill.name]?.activation ?? policy.defaults.activation) === "triggerable",
  );

  for (const skill of triggerableSkills) {
    const triggerCandidate = evaluateSkill(skill, normalizedQuery, policy, true);
    if (triggerCandidate) candidatesByName.set(skill.name, triggerCandidate);
  }

  const ftsMatches = index?.search(query, policy.candidateInjection.maxCandidates * 4) ?? [];
  const scoringPool = ftsMatches.length > 0 ? ftsMatches : skills;
  for (const skill of scoringPool) {
    const candidate = evaluateSkill(skill, normalizedQuery, policy, false);
    if (!candidate) continue;
    const previous = candidatesByName.get(skill.name);
    if (!previous || candidate.score > previous.score) {
      candidatesByName.set(skill.name, candidate);
    }
  }

  return [...candidatesByName.values()]
    .sort(compareCandidates)
    .slice(0, policy.candidateInjection.maxCandidates);
}

/**
 * Order candidates so curated trigger matches rank ahead of heuristic
 * description matches.
 *
 * Trigger matches carry a fixed score (0.95, see `evaluateSkill`), while
 * description matches can reach a higher score from short query tokens that
 * happen to appear as substrings — "is" in "history", "fix" in "prefix".
 * Sorting by score alone therefore lets that noise push a genuine trigger match
 * past a candidate cap, where it is dropped without a trace. A trigger is an
 * explicit statement that the skill is relevant, so it outranks a heuristic
 * substring match even when the heuristic scored higher.
 *
 * Every cap site must use this comparator: the per-variant cap inside
 * `retrieveCandidates` runs before expanded retrieval merges variants, so a
 * trigger match dropped there can never be restored downstream.
 */
export function compareCandidates(a: SkillCandidate, b: SkillCandidate): number {
  const triggerDelta = Number(b.reason === "trigger") - Number(a.reason === "trigger");
  if (triggerDelta !== 0) return triggerDelta;
  return b.score - a.score || a.skill.name.localeCompare(b.skill.name);
}

/**
 * Skill names the original query excludes via policy exclude triggers.
 *
 * `retrieveCandidates` evaluates excludes against whichever query string it
 * receives. Expanded retrieval passes derived variants, and a derived variant can
 * drop the surrounding context that made an exclude match ("do not use auth"
 * becomes "auth"), so the exclusion no longer applies and the skill leaks back
 * in. Callers that merge variants should apply the original query's excludes
 * across the merged set.
 */
export function excludedSkillNames(
  query: string,
  skills: SkillRecord[],
  policy: ShioriPolicy,
): Set<string> {
  const normalizedQuery = normalize(query);
  const excluded = new Set<string>();
  for (const skill of skills) {
    const excludes = policy.skills[skill.name]?.triggers?.exclude ?? [];
    if (excludes.some((trigger) => includesNormalized(normalizedQuery, trigger))) {
      excluded.add(skill.name);
    }
  }
  return excluded;
}

function evaluateSkill(
  skill: SkillRecord,
  normalizedQuery: string,
  policy: ShioriPolicy,
  exactTriggerOnly: boolean,
): SkillCandidate | undefined {
  const skillPolicy = policy.skills[skill.name];
  const excludes = skillPolicy?.triggers?.exclude ?? [];
  const matchedExclude = excludes.find((trigger) => includesNormalized(normalizedQuery, trigger));
  if (matchedExclude) return undefined;

  const includes = skillPolicy?.triggers?.include ?? [];
  const matchedInclude = includes.find((trigger) => includesNormalized(normalizedQuery, trigger));
  if (matchedInclude) {
    return attachRecommendationReason(
      {
        skill,
        score: 0.95,
        why: `matched trigger "${matchedInclude}"`,
      },
      "trigger",
      policy.candidateInjection.minScore,
    );
  }
  if (exactTriggerOnly) return undefined;

  const text = normalize(`${skill.name} ${skill.description} ${includes.join(" ")}`);
  const tokenScore = scoreTokens(normalizedQuery, text);
  if (tokenScore < policy.candidateInjection.minScore) return undefined;
  return attachRecommendationReason(
    {
      skill,
      score: tokenScore,
      why: "matched skill description",
    },
    "description",
    policy.candidateInjection.minScore,
  );
}

function normalize(input: string): string {
  return input.toLowerCase().replace(/\s+/g, " ").trim();
}

function includesNormalized(query: string, trigger: string): boolean {
  return query.includes(normalize(trigger));
}

function scoreTokens(query: string, text: string): number {
  const tokens = new Set(query.split(/[^\p{L}\p{N}_-]+/u).filter((token) => token.length >= 2));
  if (tokens.size === 0) return 0;
  let hits = 0;
  for (const token of tokens) {
    if (text.includes(token)) hits += 1;
  }
  return hits / tokens.size;
}
