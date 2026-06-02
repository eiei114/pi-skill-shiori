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
    .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
    .slice(0, policy.candidateInjection.maxCandidates);
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
    return {
      skill,
      score: 0.95,
      why: `matched trigger "${matchedInclude}"`,
    };
  }
  if (exactTriggerOnly) return undefined;

  const text = normalize(`${skill.name} ${skill.description} ${includes.join(" ")}`);
  const tokenScore = scoreTokens(normalizedQuery, text);
  if (tokenScore < policy.candidateInjection.minScore) return undefined;
  return {
    skill,
    score: tokenScore,
    why: "matched skill description",
  };
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
