# Pi Skill Shiori

Pi Skill Shiori is a [Pi](https://pi.dev/) package that keeps large Agent Skill catalogs out of the model prompt and lets the agent load only the skills that match the current task.

It is built for vaults or projects with many Agent Skills where the default catalog becomes noisy and expensive.

## What it does

- **Zero-Catalog Mode**: hides the normal skill catalog when Pi exposes one in the system prompt.
- **Policy-based retrieval**: treats skills as explicit by default and only candidates skills marked as triggerable.
- **Compact candidate injection**: injects short skill suggestions instead of full `SKILL.md` files.
- **On-demand loading**: exposes `shiori_load_skill` so the model can load one selected skill body when needed.
- **SQLite FTS retrieval**: indexes skill names, descriptions, and policy triggers with `node:sqlite` + FTS5, with token-match fallback.
- **Compact UI output**: keeps skill-load logs short while still passing full skill text to the model.

## Status

`0.1.0` is an early working release. It is useful for local Pi workflows, but the prompt-boundary suppression logic is intentionally conservative: if Shiori cannot safely recognize a catalog boundary, it leaves the prompt untouched and warns instead of deleting too much.

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

### Global install from GitHub

```bash
pi install git:github.com/eiei114/pi-skill-shiori@v0.1.0
```

Without a tag pin:

```bash
pi install git:github.com/eiei114/pi-skill-shiori
```

### Project-local install

Use `-l` to write the package to the current project’s `.pi/settings.json`:

```bash
pi install -l git:github.com/eiei114/pi-skill-shiori@v0.1.0
```

Equivalent manual `.pi/settings.json` entry:

```json
{
  "packages": [
    "git:github.com/eiei114/pi-skill-shiori@v0.1.0"
  ]
}
```

### Try without installing

```bash
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

> Note: policy/index changes can be refreshed with `/shiori:reload`, but extension code changes require restarting the Pi process because Node keeps imported extension modules cached.

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
- `alwaysVisible` lists skills that should remain visible/operational in Zero-Catalog workflows.
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
| `/shiori:doctor` | Show policy path, inventory count, retrieval backend, suppression status, and code marker. |
| `/shiori:bootstrap` | Generate a review draft policy from discovered skill descriptions. |
| `/shiori:reload` | Rebuild Shiori’s skill inventory and retrieval index. |
| `/shiori:reload --runtime` | Rebuild Shiori and ask Pi to reload runtime resources. Code changes may still need full restart. |
| `/shiori:test-query <text>` | Preview candidates for a query. |
| `/shiori:test-query --verbose <text>` | Include full descriptions, scores, paths, and load hints. |
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

## Security notes

Pi packages execute local code with the same permissions as Pi. Review third-party packages before installing them.

Shiori itself does not sandbox skills. It only changes how skill candidates are discovered and loaded. A loaded skill can still instruct the model to run tools, edit files, or execute commands according to your Pi/tool permissions.

## License

MIT
