# Pi Skill Shiori

[![CI](https://github.com/eiei114/pi-skill-shiori/actions/workflows/ci.yml/badge.svg)](https://github.com/eiei114/pi-skill-shiori/actions/workflows/ci.yml)
[![Publish](https://github.com/eiei114/pi-skill-shiori/actions/workflows/publish.yml/badge.svg)](https://github.com/eiei114/pi-skill-shiori/actions/workflows/publish.yml)
[![npm version](https://img.shields.io/npm/v/pi-skill-shiori)](https://www.npmjs.com/package/pi-skill-shiori)
[![npm downloads](https://img.shields.io/npm/dw/pi-skill-shiori)](https://www.npmjs.com/package/pi-skill-shiori)
[![License: MIT](https://img.shields.io/github/license/eiei114/pi-skill-shiori)](https://github.com/eiei114/pi-skill-shiori/blob/main/LICENSE)
![Pi Package](https://img.shields.io/badge/Pi-Package-blue)
[![Trusted Publishing](https://img.shields.io/badge/npm-provenance-yellow)](https://docs.npmjs.com/generating-provenance-statements)
<a href="https://buymeacoffee.com/ekawano114m"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" width="217" height="60"></a>

> Pi extension that keeps large Agent Skill catalogs out of the model prompt and loads only the skills that match the current task.

For maintenance priorities and the phased plan, see [`ROADMAP.md`](ROADMAP.md).

## What this is

Pi Skill Shiori is a [Pi](https://pi.dev/) package for vaults or projects with many Agent Skills where the default catalog becomes noisy and expensive. It hides the normal skill catalog when safe, recommends triggerable skills with compact summaries, and loads full `SKILL.md` bodies on demand.

`0.6.6` is the current working release. Prompt-boundary suppression is intentionally conservative: if Shiori cannot safely recognize a catalog boundary, it leaves the prompt untouched and warns instead of deleting too much.

## Features

- **Zero-Catalog Mode** — hides the normal skill catalog when Pi exposes one in the system prompt.
- **Policy-based retrieval** — treats skills as explicit by default and only candidates skills marked as triggerable.
- **Compact candidate injection** — injects short skill suggestions instead of full `SKILL.md` files.
- **On-demand loading** — exposes `shiori_load_skill` so the model can load one selected skill body when needed.
- **Vault-wide skill inventory** — indexes skills from project and user-global roots, with optional extra roots in policy.
- **SQLite FTS retrieval** — indexes skill names, descriptions, and policy triggers with `node:sqlite` + FTS5, with token-match fallback.
- **Recommendation reason badges** — compact `[trigger]`, `[description]`, and `[low match]` labels on surfaced skills.
- **Session-local feedback metrics** — `/shiori:stats` tracks offers, loads, and follow-through without storing prompts.

## Install

### Global install from npm

```bash
pi install npm:pi-skill-shiori@0.6.6
```

Without a version pin:

```bash
pi install npm:pi-skill-shiori
```

### Project-local install from npm

```bash
pi install -l npm:pi-skill-shiori@0.6.6
```

Without a version pin:

```bash
pi install -l npm:pi-skill-shiori
```

### Install from GitHub

```bash
pi install git:github.com/eiei114/pi-skill-shiori@v0.6.6
pi install -l git:github.com/eiei114/pi-skill-shiori
```

### Try without installing

```bash
pi -e npm:pi-skill-shiori
pi -e git:github.com/eiei114/pi-skill-shiori
```

### Local development install

```bash
pi install -l /absolute/path/to/pi-skill-shiori
```

## Quick start

1. Install the package (see [Install](#install)).
2. Create `.pi/skill-shiori.yml` in your Pi project (see [Docs/usage.md](Docs/usage.md#configure)).
3. Start Pi and run `/shiori:doctor` to confirm policy path, indexed roots, and suppression status.
4. Use `/shiori:bootstrap` to draft a policy from discovered skills, then `/shiori:reload` after edits.
5. Ask the agent for help; Shiori injects compact candidates or use `/shiori:recommend` for an interactive flow.

Commands take no inline arguments. Details are collected after launch via Pi UI prompts.

## Usage summary

| Command | Purpose |
|---|---|
| `/shiori:doctor` | Show policy path, indexed roots, inventory count, retrieval backend, suppression status, and code marker. |
| `/shiori:bootstrap` | Generate a review draft policy from discovered skill descriptions. |
| `/shiori:reload` | Rebuild Shiori skill inventory; optionally ask Pi to reload runtime resources. |
| `/shiori:recommend` | Interactive recommendation flow with optional pre-load. |
| `/shiori:stats` | Show operational counters and recommendation quality summary. |

Shiori registers one tool:

```ts
shiori_load_skill({ skill: "reddit-research" })
```

The model receives the full selected `SKILL.md` content. The Pi UI shows a compact result like `✓ Loaded reddit-research (6.3KB)`.

Recommended skills show compact reason badges (`[trigger]`, `[description]`, `[low match]`). See [`Docs/recommendation-surface.md`](Docs/recommendation-surface.md) for badge vocabulary and metrics interplay.

For inventory roots, policy YAML, suppression statuses, and feedback metrics, see [`Docs/usage.md`](Docs/usage.md).

## Package contents

| Path | Purpose |
|---|---|
| `src/` | Pi extension entrypoint and Shiori runtime |
| `Docs/usage.md` | Configuration, inventory, suppression, and metrics details |
| `Docs/recommendation-surface.md` | Recommendation badges and surface behavior |
| `ROADMAP.md` | Maintenance direction and phased plan |
| `CHANGELOG.md` | Version history |
| `SECURITY.md` | Vulnerability reporting |

## Development

```bash
git clone https://github.com/eiei114/pi-skill-shiori.git
cd pi-skill-shiori
npm install
npm run typecheck
npm test
```

Run in a Pi project without installing globally:

```bash
pi -e /absolute/path/to/pi-skill-shiori
```

## Release

Releases are automated via Trusted Publishing:

1. Bump `version` in `package.json` and update `CHANGELOG.md`.
2. Merge to `main`.
3. **Auto Release** tags `v<version>` and creates a GitHub release.
4. The tag triggers **Publish**, which publishes to npm with provenance.

Maintainer checks before merge:

```bash
npm run typecheck
npm test
npm run release:npm:dry
```

For version history, see [`CHANGELOG.md`](CHANGELOG.md).

## Security

Pi packages execute local code with the same permissions as Pi. Review third-party packages before installing them.

Shiori does not sandbox skills. It only changes how skill candidates are discovered and loaded. A loaded skill can still instruct the model to run tools, edit files, or execute commands according to your Pi/tool permissions.

For vulnerability reporting, see [`SECURITY.md`](SECURITY.md).

## Links

- **Repository**: <https://github.com/eiei114/pi-skill-shiori>
- **npm**: <https://www.npmjs.com/package/pi-skill-shiori>
- **Issues**: <https://github.com/eiei114/pi-skill-shiori/issues>
- **Pi packages**: <https://pi.dev/packages>

## License

MIT
