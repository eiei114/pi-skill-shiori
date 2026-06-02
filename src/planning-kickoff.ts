import type { SkillCandidate } from "./types.js";

const PLANNING_INTENT = /計画|プラン|立てたい|planning|開発計画|タスク分解|実装計画/i;

export function isPlanningIntent(query: string): boolean {
  return PLANNING_INTENT.test(query.trim());
}

export function formatPlanningKickoffMessage(query: string, candidates: SkillCandidate[]): string {
  const skillLine =
    candidates.length > 0
      ? `参考 skill: ${candidates.map((c) => c.skill.name).join(", ")}（必要なら shiori_load_skill で読む）`
      : "参考 skill: なし（to-prd / to-issues / grill-me を検討）";

  return [
    query.trim(),
    "",
    "OK。今日やる開発計画の型で進める。",
    "",
    "まずこれ埋めて：",
    "",
    "```text",
    "  対象:",
    "  やりたい変更:",
    "  使える時間:",
    "  完了条件:",
    "  不安点:",
    "```",
    "",
    "未定なら、これだけでOK：",
    "",
    "```text",
    "  対象:",
    "  変更:",
    "```",
    "",
    "受け取ったら、こう分解する：",
    "",
    "1. 現状確認",
    "2. 最小実装スコープ決定",
    "3. タスク分解",
    "4. 実行順",
    "5. テスト/確認",
    "6. 今日の完了ライン",
    "7. 余った時間の追加作業",
    "",
    "---",
    skillLine,
  ].join("\n");
}
