import { extractSearchTerms } from "./indexer.js";

/** Japanese/English aliases to improve natural-language retrieval. */
const TERM_ALIASES: Record<string, string[]> = {
  認証: ["auth", "authentication", "login"],
  ログイン: ["login", "auth"],
  スキル: ["skill"],
  ブラウザ: ["browser"],
  スクレイピング: ["scraping", "scrape"],
  スクリーンショット: ["screenshot"],
  ノート: ["note", "vault", "markdown"],
  検索: ["search"],
  デバッグ: ["debug", "diagnose"],
  バグ: ["bug", "debug"],
  朝: ["morning"],
  ルーティン: ["routine"],
  コミット: ["commit", "git"],
  プッシュ: ["push", "git"],
  リファクタ: ["refactor"],
  調査: ["research", "investigate"],
  論文: ["paper", "research"],
  投稿: ["post", "tweet"],
  計画: ["plan", "prd", "planning"],
  プラン: ["plan", "prd"],
  設計: ["design", "plan"],
  タスク: ["task", "issues"],
  分解: ["breakdown", "issues"],
};

/** Whole-prompt intents → English queries that match planning skills in descriptions. */
const INTENT_QUERY_PACKS: Array<{ test: RegExp; queries: string[] }> = [
  {
    test: /\b(?:x|twitter)\b|tweet|timeline|follower|social(?:\s+media)?/i,
    queries: [
      "tweet search social media data",
      "twitter timeline follower export",
      "x api tweet monitor",
    ],
  },
  {
    test: /計画|プラン|立てたい|planning/i,
    queries: [
      "to-prd PRD plan",
      "to-issues breakdown plan",
      "grill me plan design",
      "request refactor plan",
      "to-prd-for-oss plan",
    ],
  },
  {
    test: /開発計画|今日.*(やる|進める)|タスク分解|実装計画/i,
    queries: ["to-prd plan", "to-issues breakdown", "refactor plan", "grill me plan"],
  },
];

/** Build alternate queries for FTS + token scoring from one natural-language prompt. */
export function buildRetrievalQueries(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const queries = new Set<string>([trimmed]);
  const terms = extractSearchTerms(trimmed);
  const englishAliases: string[] = [];

  for (const pack of INTENT_QUERY_PACKS) {
    if (pack.test.test(trimmed)) {
      for (const intentQuery of pack.queries) {
        queries.add(intentQuery);
      }
    }
  }

  for (const term of terms) {
    queries.add(term);
    for (const alias of TERM_ALIASES[term] ?? []) {
      englishAliases.push(alias);
      queries.add(alias);
      const swapped = terms.map((t) => (t === term ? alias : t)).join(" ");
      if (swapped.trim()) queries.add(swapped.trim());
    }
  }

  if (englishAliases.length > 0) {
    queries.add(englishAliases.join(" "));
    if (terms.length > 0) {
      queries.add([...terms, ...englishAliases].join(" "));
    }
  }

  return [...queries];
}
