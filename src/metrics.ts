import type { ShioriStats } from "./types.js";

export function createStats(): ShioriStats {
  return {
    inventoryCount: 0,
    duplicateCount: 0,
    candidateHitCount: 0,
    zeroCandidateCount: 0,
    loadedSkillCount: 0,
    explicitInvocationCount: 0,
    retrievalBackend: "token-match",
    suppressionStatus: "disabled",
    inventoryRefreshCount: 0,
    inventoryAutoRefreshCount: 0,
  };
}
