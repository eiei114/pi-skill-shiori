export type SkillActivation = "explicit" | "triggerable";
export type RetrievalBackend = "sqlite-fts" | "token-match";
export type SuppressionStatus = "disabled" | "not-needed" | "suppressed" | "failed-pattern-not-found";

export interface ShioriPolicy {
  zeroCatalog: {
    enabled: boolean;
  };
  defaults: {
    activation: SkillActivation;
  };
  candidateInjection: {
    maxCandidates: number;
    minScore: number;
  };
  alwaysVisible: string[];
  skills: Record<string, SkillPolicy>;
}

export interface SkillPolicy {
  activation?: SkillActivation;
  path?: string;
  triggers?: {
    include?: string[];
    exclude?: string[];
  };
}

export interface SkillRecord {
  name: string;
  description: string;
  path: string;
  source: string;
}

export interface SkillCandidate {
  skill: SkillRecord;
  score: number;
  why: string;
}

export interface ShioriStats {
  inventoryCount: number;
  duplicateCount: number;
  candidateHitCount: number;
  zeroCandidateCount: number;
  loadedSkillCount: number;
  explicitInvocationCount: number;
  retrievalBackend: RetrievalBackend;
  suppressionStatus: SuppressionStatus;
  lastReloadAt?: string;
}
