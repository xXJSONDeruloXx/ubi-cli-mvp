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

- [ ] Implement `ubi login`
- [ ] Implement `ubi logout`
- [ ] Implement `ubi me`
- [ ] Persist/redact session state safely
- [ ] Add refresh logic and tests
- [ ] Document blockers if live auth needs manual intervention

### Milestone 3: library/ownership proof

Exit criteria:

- [ ] Implement `ubi list`
- [ ] Prefer live Demux ownership; add fallback if needed
- [ ] Normalize account/product data
- [ ] Add JSON output
- [ ] Add parser/normalizer tests

### Milestone 4: title metadata and manifest proof

Exit criteria:

- [ ] Implement `ubi info <title-or-id>`
- [ ] Implement `ubi manifest <title-or-id>`
- [ ] Parse manifest/build metadata where possible
- [ ] Add raw fixture coverage and parsing tests

### Milestone 5: validation and polish

Exit criteria:

- [ ] Write `docs/validation.md`
- [ ] Add smoke tests
- [ ] Update README with validated scope/limits
- [ ] Create MVP tag/release if validation supports it

## Progress log

- 2026-03-23: Initialized local git repository.
- 2026-03-23: Completed research pass across `ubisoft-demux-node`, `UplayKit`, `UplayManifests`, `ubi-cli`, Lutris, and one lower-confidence newer client for challenge/pagination notes.[1][2][4][5][6][9][11][16]
- 2026-03-23: Chosen high-level strategy: HTTP auth/session + Demux ownership/manifest where available, with GraphQL/public-dataset fallbacks for resilience.[2][4][5][6][9][11]
- 2026-03-23: Bootstrapped the TypeScript repo, added CI/lint/test tooling, implemented `ubi doctor` and `ubi config show`, and added smoke/unit tests for config/session behavior.
