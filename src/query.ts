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
};

/** Build alternate queries for FTS + token scoring from one natural-language prompt. */
export function buildRetrievalQueries(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const queries = new Set<string>([trimmed]);
  const terms = extractSearchTerms(trimmed);
  const englishAliases: string[] = [];

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
