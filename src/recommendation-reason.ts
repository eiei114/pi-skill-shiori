import type { RecommendationReasonKind, SkillCandidate } from "./types.js";

/** Score within this margin above minScore is treated as low-confidence. */
export const LOW_CONFIDENCE_MARGIN = 0.08;

export const RECOMMENDATION_REASON_LABELS: Record<RecommendationReasonKind, string> = {
  trigger: "trigger",
  description: "description",
  "low-confidence": "low match",
};

export type RecommendationMatchSource = "trigger" | "description";

export function classifyRecommendationReason(
  source: RecommendationMatchSource,
  score: number,
  minScore: number,
): RecommendationReasonKind {
  if (source === "trigger") return "trigger";
  return score < minScore + LOW_CONFIDENCE_MARGIN ? "low-confidence" : "description";
}

export function formatReasonBadge(reason: RecommendationReasonKind | null | undefined): string {
  if (!reason) return "";
  const label = RECOMMENDATION_REASON_LABELS[reason];
  return label ? `[${label}]` : "";
}

export function formatReasonBadgeSuffix(reason: RecommendationReasonKind | null | undefined): string {
  const badge = formatReasonBadge(reason);
  return badge ? ` ${badge}` : "";
}

export function attachRecommendationReason(
  candidate: Omit<SkillCandidate, "reason">,
  source: RecommendationMatchSource,
  minScore: number,
): SkillCandidate {
  return {
    ...candidate,
    reason: classifyRecommendationReason(source, candidate.score, minScore),
  };
}
