# Pi Skill Shiori

Pi Skill Shiori is a [Pi](https://pi.dev/) package that keeps large Agent Skill catalogs out of the model prompt and lets the agent load only the skills that match the current task.

It is built for vaults or projects with many Agent Skills where the default catalog becomes noisy and expensive.

For maintenance priorities and the phased plan, see [`ROADMAP.md`](ROADMAP.md).

## What it does

- **Zero-Catalog Mode**: hides the normal skill catalog when Pi exposes one in the system prompt.
- **Policy-based retrieval**: treats skills as explicit by default and only candidates skills marked as triggerable.
- **Compact candidate injection**: injects short skill suggestions instead of full `SKILL.md` files.
- **On-demand loading**: exposes `shiori_load_skill` so the model can load one selected skill body when needed.
- **Vault-wide skill inventory**: indexes skills from project and user-global roots, with optional extra roots in policy.
- **SQLite FTS retrieval**: indexes skill names, descriptions, and policy triggers with `node:sqlite` + FTS5, with token-match fallback.
- **Compact UI output**: keeps skill-load logs short while still passing full skill text to the model.

## Status

`0.5.0` is an early working release. It is useful for local Pi workflows, but the prompt-boundary suppression logic is intentionally conservative: if Shiori cannot safely recognize a catalog boundary, it leaves the prompt untouched and warns instead of deleting too much.

## Requirements

- Pi Coding Agent with package support
- Node.js `>=22.5`
- `npm`

Pi core packages are peer dependencies and should be supplied by the Pi runtime:

- `@earendil-works/pi-ai`
- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-tui`
- `typebox`

## Install

### Global install from npm

After the package is published to npm:

```bash
pi install npm:pi-skill-shiori@0.5.0
```

Without a version pin:

```bash
pi install npm:pi-skill-shiori
```

### Project-local install from npm

Use `-l` to write the package to the current project’s `.pi/settings.json`:

```bash
pi install -l npm:pi-skill-shiori@0.5.0
```

Without a version pin:

```bash
pi install -l npm:pi-skill-shiori
```

Equivalent pinned manual `.pi/settings.json` entry:

```json
{
  "packages": [
    "npm:pi-skill-shiori@0.5.0"
  ]
}
```

Equivalent unpinned manual `.pi/settings.json` entry:

```json
{
  "packages": [
    "npm:pi-skill-shiori"
  ]
}
```

### Global install from GitHub

```bash
pi install git:github.com/eiei114/pi-skill-shiori@v0.5.0
```

Without a tag pin:

```bash
pi install git:github.com/eiei114/pi-skill-shiori
```

### Project-local install from GitHub

```bash
pi install -l git:github.com/eiei114/pi-skill-shiori@v0.5.0
```

Without a tag pin:

```bash
pi install -l git:github.com/eiei114/pi-skill-shiori
```

### Try without installing

```bash
pi -e npm:pi-skill-shiori
pi -e git:github.com/eiei114/pi-skill-shiori
```

### Local development install

From a project that should use your checkout:

```bash
pi install -l /absolute/path/to/pi-skill-shiori
```

Or add a relative local path to `.pi/settings.json`:

```json
{
  "packages": [
    "../../OSS/pi-skill-shiori"
  ]
}
```

> Note: policy/index changes can be refreshed with `/shiori:reload`, and Shiori auto-refreshes the vault-wide inventory when skill files change under indexed roots. Extension code changes still require restarting the Pi process because Node keeps imported extension modules cached.

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

## Commands

| Command | Purpose |
|---|---|
| `/shiori:doctor` | Show policy path, indexed roots, inventory count, retrieval backend, suppression status, and code marker. |
| `/shiori:bootstrap` | Generate a review draft policy from discovered skill descriptions. |
| `/shiori:reload` | Ask what to reload, then rebuild Shiori’s skill inventory and optionally ask Pi to reload runtime resources. Code changes may still need full restart. |
| `/shiori:recommend` | Ask what you need help with, then either pre-load matches and queue the task for the agent or review recommendations only. Planning phrases (e.g. `計画を立てたい`) return the dev-plan intake template without dumping SKILL bodies. |
| `/shiori:stats` | Show operational counters. |

## Tool

Shiori registers one tool:

```ts
shiori_load_skill({ skill: "reddit-research" })
```

The model receives the full selected `SKILL.md` content. The Pi UI shows a compact result like:

```text
✓ Loaded reddit-research (6.3KB)
```

## Suppression statuses

`/shiori:doctor` reports the last suppression result:

| Status | Meaning |
|---|---|
| `disabled` | `zeroCatalog.enabled` is false. |
| `not-needed` | No normal Skill Catalog marker was present in that turn’s prompt, so nothing needed deletion. |
| `suppressed` | Shiori recognized and removed the normal Skill Catalog for that turn. |
| `failed-pattern-not-found` | A catalog-like marker existed, but Shiori could not safely identify its boundary. Prompt left unchanged. |

`not-needed` is not an error. It often means Pi or another configuration already avoided injecting the normal catalog.

## Retrieval backend

Shiori prefers `sqlite-fts` using Node’s built-in `node:sqlite` and FTS5. If that is unavailable, it falls back to `token-match`.

Check backend:

```text
/shiori:doctor
```

Example:

```text
retrievalBackend: sqlite-fts
code: prompt-boundary-v3
```

## Development

```bash
git clone https://github.com/eiei114/pi-skill-shiori.git
cd pi-skill-shiori
npm install
npm run typecheck
```

Run in a Pi project without installing globally:

```bash
pi -e /absolute/path/to/pi-skill-shiori
```

Recommended release checks:

```bash
npm run typecheck
npm test
```


## Publish to npm

Release checklist for npm:

```bash
npm run typecheck
npm test
npm run release:npm:dry
npm whoami
npm run release:npm
```

For version history, see [`CHANGELOG.md`](CHANGELOG.md).

For a first-time publish, login first:

```bash
npm login
```

After publishing, verify the Pi install path:

```bash
pi install npm:pi-skill-shiori@0.5.0
pi install npm:pi-skill-shiori
pi list
/shiori:doctor
```

For future versions:

```bash
npm version patch
git push --follow-tags
npm run release:npm
```

## Security

Pi packages execute local code with the same permissions as Pi. Review third-party packages before installing them.

Shiori itself does not sandbox skills. It only changes how skill candidates are discovered and loaded. A loaded skill can still instruct the model to run tools, edit files, or execute commands according to your Pi/tool permissions.

For vulnerability reporting, see [`SECURITY.md`](SECURITY.md).

## License

MIT
