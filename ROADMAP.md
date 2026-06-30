# Roadmap

Pi Skill Shiori keeps large Agent Skill catalogs out of the model prompt and lets
the agent load only the skills that match the current task. This roadmap states
**what we prioritize next** and how the package is maintained.

## Direction

`0.3.x` is a working release. The near-term priority is **stabilization and
public quality over new feature surface**. Before widening functionality, we
harden what already ships:

- **Stabilize existing behavior** — make catalog suppression and retrieval reliable.
- **Speed and token efficiency** — startup cost, index rebuild, and candidate injection footprint.
- **Explicit design boundaries** — name the contracts (policy file, hook activation, suppression).
- **Template compliance** — close gaps against the shared Pi extension OSS policy.
- **Publish quality** — README, CHANGELOG, SECURITY, CI, `npm pack`, and release handoff.

Constraints:

- Existing commands, tools, and the main UX stay unless a compatibility fix is required.
- `shiori:*` commands stay argument-less; detail is collected after launch via Pi UI.
- npm publish stays Trusted Publishing / OIDC. Secrets and production actions remain human-owned.

## Skill features vs. template requirements

Two kinds of work are tracked separately so feature work is not confused with
packaging/hygiene work:

- **Skill features** — Zero-Catalog suppression, policy-based retrieval, candidate
  injection, on-demand loading, hybrid retrieval. These change what the package does.
- **Template requirements** — README badges, CI gates, `npm pack` cleanliness, action
  pinning, version-bump checks. These keep the package publishable and aligned with
  `pi-extension-template`.

Template gaps are addressed first because they protect every later release.

## Maintenance schedule

- **Patch release** — as needed for fixes, doc/template compliance, and small behavior changes.
- **Minor release** — retrieval quality or candidate-flow improvements.
- **Release cadence** — ship per ready slice; no fixed calendar release. Every mergeable
  change bumps `package.json` and `CHANGELOG.md` so npm can publish.
- **Dependency review** — monthly; bump `devDependencies`/Pi peers without behavior change.
- **Release flow** — `npm version <patch|minor>` → push → `auto-release.yml` tags and
  releases → `publish.yml` publishes via Trusted Publishing (provenance verified).

`/shiori:stats` reports operational counters (token saved, candidate hits, loads,
zero-candidate turns, explicit invocations) that feed back into this schedule.

## Phased goals (Month 1–3)

Each item is a small, independently verifiable slice (roughly 30–90 minutes) with a
semver classification. Patches default to `patch`; `none` means no package publish.

### Month 1 — Public quality and template compliance

| # | Slice | Bump | Status |
|---|---|---|---|
| 1 | Add README status badges (CI, Publish, npm version, npm downloads, License, Pi package, Trusted Publishing) | patch | done |
| 2 | Add `version:check` CI gate (block publishable-path changes without a semver increase) | none | planned |
| 3 | Pin GitHub Actions to commit SHAs in `ci.yml`, `auto-release.yml`, `publish.yml` | none | planned |

### Month 2 — Stabilization and design boundaries

| # | Slice | Bump | Status |
|---|---|---|---|
| 4 | Harden catalog boundary detection and add boundary tests (reduce `failed-pattern-not-found`) | patch | planned |
| 5 | Integration test for Dual Hook Activation (input-hook explicit pass-through + `before_agent_start` candidate injection) | none | planned |

### Month 3 — Speed and token efficiency

| # | Slice | Bump | Status |
|---|---|---|---|
| 6 | Add startup/operation timing instrumentation to `/shiori:stats` (Full Index Rebuild + retrieval baseline) | patch | planned |
| 7 | Startup index strategy (incremental / lazy / cached) — needs a design decision before implementation | none | blocked (design) |

## Integration testing for skill hooks

Dual Hook Activation is the core discovery path and must be covered end to end:

- **Input hook** — explicit invocation pass-through: `/skill:name` and explicit names load
  regardless of activation policy, including under Zero-Catalog Mode.
- **`before_agent_start` hook** — automatic candidate injection for triggerable skills only,
  bounded by `maxCandidates` and `minScore`, with explicit skills excluded.

The Month 2 integration test asserts both paths together (explicit load still works while
triggerable candidates are injected) so a regression in one hook surfaces immediately.

## Template compliance checklist

Current status against the shared Pi extension OSS policy. Gaps become Month 1 work.

- [x] `README.md`, `LICENSE`, `SECURITY.md`, `CHANGELOG.md` at repo root
- [x] CI runs `npm run typecheck`, `npm test`, and `npm pack --dry-run`
- [x] npm Trusted Publishing (`publish.yml` uses `id-token: write`, no `NPM_TOKEN`)
- [x] `auto-release.yml` → `publish.yml` release handoff
- [x] `package.json` `files` is explicit (no `node_modules`, tests, or local state)
- [x] No template `example-skill` / `example` / `example-theme` resources shipped
- [ ] **README status badges** (CI, Publish, npm version, npm downloads, License, Pi package, Trusted Publishing) — *Month 1 #1*
- [ ] **`version:check` CI gate** so publishable-path changes cannot merge without a bump — *Month 1 #2*
- [ ] **Pin GitHub Actions to commit SHAs** (currently floating `@v4`) — *Month 1 #3*

## Current backlog integration

Feature-track items already shipped (kept here so the roadmap reflects reality, not a
fresh to-do list):

- Recommendation-first `/shiori:recommend` flow with query expansion and planning intent — shipped (`0.2.0`)
- CI + auto-release + publish handoff — shipped (`0.1.1`+)
- `shiori:*` commands use Pi UI flows (argument-less) — shipped (`0.3.0`)
- `SECURITY.md` and `CHANGELOG.md` — shipped (`0.3.1`)

Remaining feature-track item, deferred behind the maintenance-first direction:

- README/docs alignment with the minimal public-docs policy — open; the Month 1 badge
  and CI slices advance this track without blocking on the broader docs-policy decision.

## Later (feature track)

- Retrieval quality improvements (embedding candidate added beside SQLite FTS).
- Cross-vault skill index.
- ResourceLoader-side catalog replacement (stable-stage Two-stage Catalog Suppression).

These are intentionally **after** the Month 1–3 maintenance work.

## Non-goals

- Rewriting existing commands, tools, or the candidate/recommend UX.
- Auto-approving npm publish, permission changes, or production actions.
- Removing the conservative catalog-suppression safety boundary (`not-needed` /
  `failed-pattern-not-found` stay safe-by-default).
