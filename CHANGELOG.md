# Changelog

All notable changes to this project will be documented in this file.

This project follows semantic versioning.

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
