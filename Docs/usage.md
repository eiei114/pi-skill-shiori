# Usage

Detailed configuration and operational notes for Pi Skill Shiori. For install and quick start, see [README](../README.md).

## Requirements

- Pi Coding Agent with package support
- Node.js `>=22.5`
- `npm`

Pi core packages are peer dependencies and should be supplied by the Pi runtime:

- `@earendil-works/pi-ai`
- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-tui`
- `typebox`

## Vault-wide skill inventory

Shiori builds a searchable inventory from these roots (in discovery order; first match wins on duplicate skill names):

| Root | Scope |
|---|---|
| `<cwd>/.pi/skills` | Project-local Pi skills |
| `<cwd>/.agents/skills` | Project-local Agent skills |
| `~/.pi/agent/skills` | User-global Pi agent skills |
| `inventory.roots` entries | Optional extra roots (relative to `<cwd>` or absolute) |

Refresh behavior:

- **Session start** builds the initial inventory and SQLite FTS index.
- **Auto-refresh** (default) rescans roots before retrieval when any `SKILL.md` path changes. This is a directory walk only; it rebuilds the FTS index when the fingerprint changes.
- **Manual refresh** via `/shiori:reload` always rebuilds the inventory and FTS index immediately.
- Disable auto-refresh when you prefer a fixed snapshot:

```yaml
inventory:
  autoRefreshOnChange: false
  roots:
    - custom-skills
```

Cost/latency trade-offs:

- Auto-refresh adds a shallow filesystem walk on each agent turn while enabled. It avoids stale search results after local skill edits without restarting Pi.
- A full refresh rebuilds the SQLite FTS database and scales with total indexed skills and description length. Large vaults with many roots may prefer `autoRefreshOnChange: false` plus explicit `/shiori:reload` after bulk imports.
- Search stays description-first and policy-aware: only `triggerable` skills become candidates, with FTS ranking over names, descriptions, and policy triggers.

## Configure

Create `.pi/skill-shiori.yml` in the project where Pi runs.

Shiori also supports a user-global policy at `~/.pi/agent/skill-shiori.yml`. Policy resolution order is:

1. Project policy: `<cwd>/.pi/skill-shiori.yml`
2. User-global policy: `~/.pi/agent/skill-shiori.yml`
3. Built-in defaults

Use the user-global policy for personal defaults that should apply across projects, such as enabling Zero-Catalog Mode everywhere. Use a project policy when a workspace needs different trigger rules, inventory roots, or catalog behavior; project policy always wins over user-global policy.

Minimal config:

```yaml
zeroCatalog:
  enabled: true

defaults:
  activation: explicit

candidateInjection:
  maxCandidates: 3
  minScore: 0.62

alwaysVisible:
  - pi-skill-shiori

skills:
  reddit-research:
    activation: triggerable
    triggers:
      include:
        - Reddit
        - Redditで調べて
        - reputation on Reddit
      exclude: []
```

Policy rules:

- `defaults.activation: explicit` is the safe default. Unlisted skills are not auto-candidates.
- `activation: triggerable` allows Shiori to recommend the skill for matching requests.
- `alwaysVisible` lists skills that should remain visible in the Skill Catalog during Zero-Catalog Mode. Use this for a tiny safety-critical allowlist instead of broad trigger rules.
- Missing `alwaysVisible` entries are reported by `/shiori:doctor` and warned once per session when Zero-Catalog Mode runs.
- `candidateInjection.maxCandidates` limits how many suggestions enter the prompt.
- `candidateInjection.minScore` drops weak matches.

Generate a starter policy from discovered skills:

```text
/shiori:bootstrap
```

This writes a generated review file next to `.pi/skill-shiori.yml`. Review it before using it as your real policy.

## Suppression statuses

`/shiori:doctor` reports the last suppression result:

| Status | Meaning |
|---|---|
| `disabled` | `zeroCatalog.enabled` is false. |
| `not-needed` | No normal Skill Catalog marker was present in that turn's prompt, so nothing needed deletion. |
| `suppressed` | Shiori recognized and removed the normal Skill Catalog for that turn. |
| `failed-pattern-not-found` | A catalog-like marker existed, but Shiori could not safely identify its boundary. Prompt left unchanged. |

`not-needed` is not an error. It often means Pi or another configuration already avoided injecting the normal catalog.

## Retrieval backend

Shiori prefers `sqlite-fts` using Node's built-in `node:sqlite` and FTS5. If that is unavailable, it falls back to `token-match`.

Check backend:

```text
/shiori:doctor
```

Example:

```text
retrievalBackend: sqlite-fts
code: prompt-boundary-v3
```

## Recommendation feedback metrics

`/shiori:stats` includes session-local recommendation feedback so operators can tune trigger rules from real outcomes instead of guesswork.

Recorded (bounded, in-memory for the current Pi session):

- recommendation offers and candidate slot counts per source (`auto-inject`, `command`, `tool`)
- load follow-through when recommended skills are pre-loaded or later loaded via `shiori_load_skill`
- abandoned recommendation flows (candidates shown but not loaded, e.g. review-only mode)
- zero-candidate queries (obvious misses)
- per-skill offered/loaded tallies (up to 50 skill names, oldest entries dropped first)

Not recorded:

- user prompts, task descriptions, or transcript bodies
- skill `SKILL.md` contents
- filesystem paths beyond skill names already visible in policy/inventory

Retention boundary:

- counters reset when the Pi session ends
- no disk persistence or cross-session analytics in this slice
- inspect the compact summary at the top of `/shiori:stats`, with full JSON below

Example summary line:

```text
Recommendation feedback (session-local, no prompts stored)
offers: 4 | candidate slots: 7 | loaded: 3
abandoned: 1 | zero-candidate queries: 2 | follow-through: 42.9%
auto-inject: offers=2, loaded=1, zeroHits=1
command: offers=1, loaded=2, zeroHits=1
top skills: auth-helper(1/2), deploy-kit(1/1)
```

## Related docs

- [Recommendation surface](recommendation-surface.md) — reason badges, Always Visible policy, and metrics interplay
