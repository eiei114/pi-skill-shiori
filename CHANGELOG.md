# Changelog

## Unreleased

- Add Buy Me a Coffee sponsor button to README and native GitHub funding link via `.github/FUNDING.yml`.

## [0.6.5] - 2026-07-07

### Fixed

- Aligned npm publish and auto-release GitHub Actions with the standard managed OSS workflow so version bumps on `main` create a tag/release and dispatch the publish workflow reliably.
- Hardened publish-version detection so already-published versions skip cleanly while unexpected npm lookup failures still fail the workflow.

### Changed

- Updated release automation to the shared workflow pattern used by other managed OSS repos.

## [0.6.4] - 2026-07-07

### Fixed

- Rebuild the Shiori inventory when the effective policy source or policy contents change mid-session, so `/shiori:doctor` and runtime behavior stay aligned after adding or updating a global policy file.
- Add a regression test covering a global policy file appearing after session start.

All notable changes to this project will be documented in this file.

This project follows semantic versioning.

## [0.6.2] - 2026-07-02

### Fixed

- Expanded retrieval (`retrieveCandidatesExpanded`) now preserves `[trigger]` badges when query variants also score the skill higher via description tokens.

### Changed

- `Docs/recommendation-surface.md` documents the dogfood review outcome and recommendation to keep badges on default surfaces.

## [0.6.1] - 2026-07-01

### Changed

- README aligned with Pi OSS minimal-docs policy: badges, required entrypoint sections, Quick start, Package contents, Links.
- Detailed configuration and operational notes moved to `Docs/usage.md`.
- README install examples and status text updated to match package version `0.6.1`.

## [0.6.0] - 2026-06-29

### Added

- Bounded recommendation reason badges (`[trigger]`, `[description]`, `[low match]`) on recommended skills in auto-inject, `/shiori:recommend`, and `shiori_recommend` surfaces.
- `Docs/recommendation-surface.md` describing badge vocabulary, a multi-skill example, and how badges relate to Always Visible Skill policy and recommendation metrics.
- Tests for reason present, absent, low-confidence, and badge formatting.

### Changed

- Candidate summaries use compact badges instead of freeform `Why:` lines in the default Shiori surfaces.

## [0.5.0] - 2026-06-28

### Added

- Vault-wide skill inventory: Shiori indexes skills from project `.pi/skills`, `.agents/skills`, the user-global `~/.pi/agent/skills` root, and optional policy `inventory.roots`.
- Automatic inventory refresh when skill files change under any indexed root (enabled by default; disable with `inventory.autoRefreshOnChange: false`).
- `/shiori:doctor` now lists indexed roots with per-root skill counts and auto-refresh status.
- `/shiori:stats` counters for manual and automatic inventory refreshes.
- Tests for multi-root discovery, refresh after local changes, and policy-aware retrieval.

### Changed

- `/shiori:reload` rebuilds the vault-wide inventory and SQLite FTS index instead of relying on the session-start snapshot only.

## [0.4.0] - 2026-06-28

### Added

- Always Visible Skill policy: Zero-Catalog Mode now keeps only `alwaysVisible` allowlisted skills in the Skill Catalog instead of hiding every entry.
- Diagnostics for missing or duplicate `alwaysVisible` policy entries in `/shiori:doctor` and one-time runtime warnings for missing skills.
- Tests for visible, missing, duplicate, and markdown catalog filtering cases.

### Changed

- `alwaysVisible` policy entries are normalized to a deduplicated allowlist at load time.

## [0.3.2] - 2026-06-24

### Added

- `ROADMAP.md` with maintenance-first phased goals (Month 1–3), template compliance checklist, and maintenance schedule.
- README links to `ROADMAP.md`.
- npm package `files` now includes `ROADMAP.md`.

## [0.3.1] - 2026-06-19

### Added

- `SECURITY.md` with vulnerability reporting guidance and Pi package security notes.
- `CHANGELOG.md` for version history.

### Changed

- README links to `SECURITY.md` and `CHANGELOG.md`.
- npm package files now include `SECURITY.md` and `CHANGELOG.md`.

## [0.3.0] - 2026-06-08

### Changed

- Shiori slash commands use UI flows for doctor, bootstrap, reload, recommend, and stats.

## [0.2.1] - 2026-06-02

### Changed

- Patch release after the recommendation flow updates in `0.2.0`.

## [0.2.0] - 2026-06-02

### Added

- Recommendation-first `/shiori:recommend` flow with query expansion and agent task queuing.
- Pre-loading of multiple recommended skills in one agent turn.
- Planning-intent handling that returns a dev-plan intake template without dumping skill bodies.

### Fixed

- Skill retrieval for block descriptions and Japanese queries.

### Changed

- README install snippets aligned with the published package version.

## [0.1.1] - 2026-05-26

### Added

- npm publish workflow and auto-release on merge to `main`.
- npm publish commands and unpinned install examples in README.

## [0.1.0] - 2026-05-24

### Added

- Initial Pi Skill Shiori release.
- Zero-Catalog mode, policy-based retrieval, SQLite FTS indexing, and on-demand `shiori_load_skill` tool.
