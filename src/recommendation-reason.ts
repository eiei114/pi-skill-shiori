import type { RecommendationReasonKind, SkillCandidate } from "./types.js";

/** Score within this margin above minScore is treated as low-confidence. */
export const LOW_CONFIDENCE_MARGIN = 0.08;

export const RECOMMENDATION_REASON_LABELS: Record<RecommendationReasonKind, string> = {
  trigger: "trigger",
  description: "description",
  "low-confidence": "low match",
};

export function classifyRecommendationReason(
  candidate: Pick<SkillCandidate, "score" | "why">,
  minScore: number,
): RecommendationReasonKind | null {
  if (candidate.why.startsWith('matched trigger "')) {
    return "trigger";
  }

  if (candidate.why === "matched skill description") {
    if (candidate.score < minScore + LOW_CONFIDENCE_MARGIN) {
      return "low-confidence";
    }
    return "description";
  }

  return null;
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
  minScore: number,
): SkillCandidate {
  return {
    ...candidate,
    reason: classifyRecommendationReason(candidate, minScore),
  };
}
