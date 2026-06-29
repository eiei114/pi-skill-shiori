# Recommendation surface

This document describes how Pi Skill Shiori surfaces recommended skills and the bounded reason badges shown with each match.

## Reason badges

Shiori attaches a compact reason badge to each recommended skill. The vocabulary is intentionally small:

| Badge | Meaning |
|---|---|
| `[trigger]` | A policy `triggers.include` phrase matched the user task. |
| `[description]` | Skill name/description tokens matched strongly enough to pass `candidateInjection.minScore`. |
| `[low match]` | The skill passed `minScore` but sits near the threshold; treat as a weaker suggestion. |

When Shiori cannot classify a match, it omits the badge instead of inventing a freeform explanation.

## Where badges appear

- **Auto-inject candidates** in the system prompt (`## Pi Skill Shiori Candidates`)
- **`/shiori:recommend` review mode** notifications and follow-up picker labels
- **`shiori_recommend` tool** collapsed result line (badges only, no long reports)
- **Pre-load summaries** when skills are queued for the agent

Badges are labels, not confidence scores. Numeric scores remain available in expanded detail views when needed.

## Example: multiple surfaced skills

Task: `browser scraping screenshot`

Possible matches:

```text
Matched 2 skill(s): playwright-cli [trigger], gstack-browse [description]
```

Auto-inject candidate block:

```text
## Pi Skill Shiori Candidates

Relevant skills:
- playwright-cli [trigger]: Browser automation, web scraping, screenshots. Load: shiori_load_skill({ skill: "playwright-cli" })
- gstack-browse [description]: Headless browser QA for scripted flows. Load: shiori_load_skill({ skill: "gstack-browse" })
```

A near-threshold match degrades gracefully:

```text
- notes-helper [low match]: Search markdown notes in the vault. Load: shiori_load_skill({ skill: "notes-helper" })
```

## Relation to Always Visible Skill

`alwaysVisible` controls which skills stay in the Skill Catalog during Zero-Catalog Mode. Reason badges apply only to **recommended** (`triggerable`) skills surfaced by retrieval — not to always-visible catalog entries.

Always-visible skills may still appear as recommendations when they match a task; their badge explains the retrieval reason, not catalog visibility.

## Relation to recommendation metrics

`/shiori:stats` recommendation feedback records offers, loads, and follow-through by source (`auto-inject`, `command`, `tool`). Metrics do **not** store reason badges or per-reason tallies.

Use badges to understand individual suggestions during a session. Use metrics to see whether recommendations are being loaded after they are offered.
