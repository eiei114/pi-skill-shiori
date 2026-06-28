export type RecommendationSource = "auto-inject" | "command" | "tool";

export interface SourceFeedbackCounts {
  offers: number;
  candidateSlots: number;
  loaded: number;
  zeroHits: number;
}

export interface SkillFeedbackCounts {
  offered: number;
  loaded: number;
}

export interface RecommendationFeedbackSummary {
  totalOffers: number;
  totalCandidateSlots: number;
  totalLoaded: number;
  totalAbandoned: number;
  zeroCandidateQueries: number;
  followThroughRate: number | null;
  bySource: Record<RecommendationSource, SourceFeedbackCounts>;
  topSkills: Array<{ name: string; offered: number; loaded: number }>;
  retention: {
    maxSkillEntries: number;
    skillEntries: number;
  };
}

const SOURCES: RecommendationSource[] = ["auto-inject", "command", "tool"];
const MAX_SKILL_ENTRIES = 50;

function emptySourceCounts(): SourceFeedbackCounts {
  return { offers: 0, candidateSlots: 0, loaded: 0, zeroHits: 0 };
}

function emptyBySource(): Record<RecommendationSource, SourceFeedbackCounts> {
  return {
    "auto-inject": emptySourceCounts(),
    command: emptySourceCounts(),
    tool: emptySourceCounts(),
  };
}

export interface RecommendationFeedback {
  recordRecommendation(source: RecommendationSource, candidates: string[], loaded?: string[]): void;
  recordZeroCandidates(source: RecommendationSource): void;
  recordSkillLoaded(skillName: string): void;
  summarize(): RecommendationFeedbackSummary;
  formatSummary(): string;
}

export function createRecommendationFeedback(): RecommendationFeedback {
  const bySource = emptyBySource();
  const bySkill = new Map<string, SkillFeedbackCounts>();
  const recentAutoInjectCandidates = new Set<string>();

  let totalOffers = 0;
  let totalCandidateSlots = 0;
  let totalLoaded = 0;
  let totalAbandoned = 0;
  let zeroCandidateQueries = 0;

  function bumpSkill(name: string, field: "offered" | "loaded"): void {
    const current = bySkill.get(name) ?? { offered: 0, loaded: 0 };
    current[field] += 1;
    bySkill.set(name, current);
    while (bySkill.size > MAX_SKILL_ENTRIES) {
      const oldest = bySkill.keys().next().value;
      if (oldest === undefined) break;
      bySkill.delete(oldest);
    }
  }

  function recordLoadedSkills(source: RecommendationSource, loaded: string[]): void {
    for (const name of loaded) {
      bumpSkill(name, "loaded");
      bySource[source].loaded += 1;
      totalLoaded += 1;
      recentAutoInjectCandidates.delete(name);
    }
  }

  return {
    recordRecommendation(source, candidates, loaded = []) {
      if (candidates.length === 0) {
        this.recordZeroCandidates(source);
        return;
      }

      totalOffers += 1;
      totalCandidateSlots += candidates.length;
      const sourceCounts = bySource[source];
      sourceCounts.offers += 1;
      sourceCounts.candidateSlots += candidates.length;

      for (const name of candidates) {
        bumpSkill(name, "offered");
        if (source === "auto-inject") {
          recentAutoInjectCandidates.add(name);
        }
      }

      if (loaded.length > 0) {
        recordLoadedSkills(source, loaded);
      } else if (source !== "auto-inject") {
        totalAbandoned += 1;
      }
    },

    recordZeroCandidates(source) {
      zeroCandidateQueries += 1;
      bySource[source].zeroHits += 1;
    },

    recordSkillLoaded(skillName) {
      if (!recentAutoInjectCandidates.has(skillName)) {
        return;
      }
      recordLoadedSkills("auto-inject", [skillName]);
    },

    summarize() {
      const followThroughRate =
        totalCandidateSlots > 0 ? Number((totalLoaded / totalCandidateSlots).toFixed(3)) : null;

      const topSkills = [...bySkill.entries()]
        .map(([name, counts]) => ({ name, ...counts }))
        .sort((a, b) => b.offered - a.offered || a.name.localeCompare(b.name))
        .slice(0, 10);

      return {
        totalOffers,
        totalCandidateSlots,
        totalLoaded,
        totalAbandoned,
        zeroCandidateQueries,
        followThroughRate,
        bySource,
        topSkills,
        retention: {
          maxSkillEntries: MAX_SKILL_ENTRIES,
          skillEntries: bySkill.size,
        },
      };
    },

    formatSummary() {
      const summary = this.summarize();
      const rate =
        summary.followThroughRate === null ? "n/a" : `${(summary.followThroughRate * 100).toFixed(1)}%`;
      const lines = [
        "Recommendation feedback (session-local, no prompts stored)",
        `offers: ${summary.totalOffers} | candidate slots: ${summary.totalCandidateSlots} | loaded: ${summary.totalLoaded}`,
        `abandoned: ${summary.totalAbandoned} | zero-candidate queries: ${summary.zeroCandidateQueries} | follow-through: ${rate}`,
      ];

      for (const source of SOURCES) {
        const counts = summary.bySource[source];
        if (counts.offers === 0 && counts.zeroHits === 0) continue;
        lines.push(
          `${source}: offers=${counts.offers}, loaded=${counts.loaded}, zeroHits=${counts.zeroHits}`,
        );
      }

      if (summary.topSkills.length > 0) {
        const skillLine = summary.topSkills
          .slice(0, 5)
          .map((skill) => `${skill.name}(${skill.loaded}/${skill.offered})`)
          .join(", ");
        lines.push(`top skills: ${skillLine}`);
      }

      return lines.join("\n");
    },
  };
}
