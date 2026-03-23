# Roadmap

## Milestones

### Milestone 0: research and plan

Exit criteria:

- [x] Gather public sources
- [x] Write `docs/research.md`
- [x] Write `docs/architecture.md`
- [x] Write `docs/references.md`
- [x] Identify major technical risks and fallback paths

### Milestone 1: repo bootstrap

Exit criteria:

- [x] Initialize Node/TypeScript repo
- [x] Add lint, format, test, typecheck, CI
- [x] Create CLI entrypoint
- [x] Implement `ubi doctor`
- [x] Confirm scripts: `build`, `test`, `lint`, `format`, `dev`

### Milestone 2: auth/session proof

Exit criteria:

- [x] Implement `ubi login`
- [x] Implement `ubi logout`
- [x] Implement `ubi me`
- [x] Persist/redact session state safely
- [x] Add refresh logic and tests
- [x] Document blockers if live auth needs manual intervention

### Milestone 3: library/ownership proof

Exit criteria:

- [x] Implement `ubi list`
- [x] Prefer live Demux ownership; add fallback if needed _(evidence forced the GraphQL fallback path; live Demux is blocked and documented)_
- [x] Normalize account/product data
- [x] Add JSON output
- [x] Add parser/normalizer tests

### Milestone 4: title metadata and manifest proof

Exit criteria:

- [x] Implement `ubi info <title-or-id>`
- [x] Implement `ubi manifest <title-or-id>`
- [x] Parse manifest/build metadata where possible
- [x] Add raw fixture coverage and parsing tests

### Milestone 5: validation and polish

Exit criteria:

- [x] Write `docs/validation.md`
- [x] Add smoke tests
- [x] Update README with validated scope/limits
- [ ] Create MVP tag/release if validation supports it

## Progress log

- 2026-03-23: Initialized local git repository.
- 2026-03-23: Completed research pass across `ubisoft-demux-node`, `UplayKit`, `UplayManifests`, `ubi-cli`, Lutris, and one lower-confidence newer client for challenge/pagination notes.[1][2][4][5][6][9][11][16]
- 2026-03-23: Chosen high-level strategy: HTTP auth/session + Demux ownership/manifest where available, with GraphQL/public-dataset fallbacks for resilience.[2][4][5][6][9][11]
- 2026-03-23: Bootstrapped the TypeScript repo, added CI/lint/test tooling, implemented `ubi doctor` and `ubi config show`, and added smoke/unit tests for config/session behavior.
- 2026-03-23: User provided local `.env` credentials for live testing; keep all command output and logs sanitized.
- 2026-03-23: Validated live auth (`login`, `logout`, `me`) against the public Ubisoft session/user endpoints.
- 2026-03-23: Validated live GraphQL library listing for the test account and confirmed partial product-ID mapping through the public `UplayManifests` datasets.
- 2026-03-23: Validated `info` and `manifest` flows using a mix of live resolution and public manifest fixtures; documented the blocked live Demux path in `docs/validation.md`.
- 2026-03-23: Improved product-config parsing so localized config keys like `l1` resolve to readable titles and fallback game-code fields such as `achievements_sync_id` are surfaced in `ubi info`.
- 2026-03-23: Added deduped library output, title search, public catalog disambiguation support, associated-product/DLC exploration, manifest file listing, and dry-run download planning from public fixtures.
- 2026-03-23: Broke through the Demux connectivity problem by forcing TLS 1.2 and following the patch-version-plus-clientVersion handshake; validated live ownership initialization, ownership-token retrieval, and download-service signed manifest URL retrieval.[19][20]
