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
- [x] Add live Demux ownership alongside the resilient GraphQL library path; keep both surfaces because their identifiers and coverage differ
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

### Milestone 6: guarded desktop-client integration

Exit criteria:

- [x] Bootstrap a pinned official Connect client in an explicit Wine prefix
- [x] Keep first-ever authentication/MFA inside the official client; never convert or inject the CLI session
- [x] Seed a paused official download without writing client registry/state/manifest metadata
- [x] Return final verification/finalization to Connect
- [x] Launch a registered product through the official `uplay://` handler
- [x] Persist non-secret product/prefix/install profiles for a concise `ubi play <query>` workflow
- [x] Monitor the profiled game lifecycle and stop Connect after exit to remove residual launcher/promotional UI
- [x] Establish one shared persistent prefix as the safe remembered-auth model; constrain auth-prefix cloning to explicit one-way migration
- [x] Guardedly migrate opaque official Connect AppData plus its Wine device binding into an existing stopped prefix without decoding authentication state
- [x] Use the supported `uplay://install/<productId>` handler to open first-install confirmations without library navigation
- [x] Establish that no supported public desktop-ticket handoff or language/path/auto-confirm install API is currently documented; do not guess parameters or synthesize client state
- [ ] Add a guarded wait/orchestration mode around client-owned staging creation
- [ ] Validate the bridge on another owned title/build before treating it as general

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
- 2026-03-23: Implemented `demux-list`, `demux-info`, `download-urls`, `slice-urls`, `download-slices`, and live Demux-backed `manifest/files/download-plan --live` flows with passing unit/smoke coverage.
- 2026-03-23: Fixed download-service asset URL extraction so `.manifest`, `.metadata`, and `.licenses` URLs are recognized even when returned as alternates under a single manifest response row; added `manifest --live --with-assets` to fetch and parse live metadata/license assets for owned titles.
- 2026-03-23: Added `extract-file` to experimentally reconstruct an individual file from live manifest slice metadata; live validation succeeded for an Origins readme file and established a partial path beyond raw slice downloads.
- 2026-03-23: Corrected download-service URL-response normalization for multi-path slice requests by grouping returned CDN URLs by parsed pathname instead of assuming one response row per requested path.
- 2026-03-23: Fixed `extract-file` for live multi-slice files whose parsed `sliceList[].fileOffset` values materialize as protobuf default zeroes; the extractor now falls back to sequential offsets in that case and validates decompressed slice SHA-1 values against manifest `slices[]` hashes.
- 2026-03-23: Added `extract-files` for experimental batch reconstruction of multiple matching live manifest files, sharing slice downloads across the batch when possible.
- 2026-03-23: Added normalized manifest-path matching helpers and `files --match/--prefix` filtering so live manifests can be narrowed down before extraction.
- 2026-03-23: Added persistent local slice-cache reuse for raw-slice download and extraction flows, reducing repeated `extract-file` network bytes to zero on cache hits.
- 2026-03-23: Added path-filtered `download-plan --match/--prefix` support so live/public manifest plans can be scoped to a subset of files even before true chunk-selection logic exists.
- 2026-03-23: Added `download-game` as a first-pass full-tree reconstruction command for owned live manifests, plus zlib slice decompression support needed by older titles such as Splinter Cell.
- 2026-03-24: Added signed-URL refresh on 403, skip-existing resume behavior, and parallel full-tree reconstruction workers; used those improvements to complete a full Splinter Cell manifest-tree download over multiple runs.
- 2026-03-24: Added a pre-scan that skips slice URL resolution for already-complete files during full-tree resume runs, reducing repeated Splinter Cell validation to zero downloaded bytes on a complete rerun.
- 2026-03-24: Reused a single Demux `download_service` connection across repeated URL lookups, added regression coverage for that behavior, and live-validated a full 5844-slice Splinter Cell URL-resolution run without the earlier listener warning.
- 2026-07-11: Hardened session persistence and redacted login JSON secrets; added manifest-path containment, symlink-resistant output parents, atomic extraction publication, manifest-bound SHA-256 resume state, disk preflight, bounded/dry-run game selection, cancellation, and progress reporting. Whole-manifest downloads now require explicit `--all --yes`.
- 2026-07-11: Replaced 32-prefix CDN probing with deterministic hash-derived paths and reused per-product Demux initialization. A resumed 5,320-file / 2.55-GB Splinter Cell reconstruction completed in 5m49s, followed by a 14-second zero-network SHA-256 verification. Updated `run` to use the executable directory as cwd; legitimate Wine/Ubisoft Connect testing confirmed that client authentication and entitlement remain an external user boundary.
- 2026-07-12: Added guided Connect launch support with explicit Wine prefixes, repeatable runner arguments, pinned official installer download/offline reuse, exact SHA-256 and PE certificate-table checks, and explicit install consent. Live-tested fresh-prefix installation and authenticated product-id 109 startup without transferring credentials.
- 2026-07-13: Added guarded `connect-seed` bridging for a paused official download. Live product-109 validation seeded 2,237 mismatched files / 2.52 GB in 22s, after which Connect finalized instantly and all 5,320 installed payload hashes matched the CLI source. Both official Play and `uplay://launch/109/0` ran the game successfully. Remaining manual steps are first Connect authentication/MFA and one official Download initiation to create client-owned staging metadata.
- 2026-07-13: Added owner-only non-secret Connect profiles and `ubi play`; live validation launched product 109, tracked normal game exit, and stopped Connect automatically. A Btrfs whole-prefix auth clone opened signed in but invalidated the source after token rotation, establishing one shared prefix as the default and cloning as one-way migration only.
- 2026-07-13: Confirmed `uplay://install/82` opens the official Assassin's Creed language/install confirmation directly. Added `connect-install` to remove library navigation while intentionally leaving authentication and confirmation dialogs to Connect.
- 2026-07-13: Isolated remembered desktop authentication: secure-storage files or complete AppData alone failed in a clean prefix, while opaque Connect AppData plus the matching Wine `MachineGuid` regenerated ownership without login and copied no game registration. Added guarded `connect-prefix migrate-auth`; migration remains one-way because token refresh can retire the source.
- 2026-07-13: Repeated the product-109 bridge from a genuinely fresh authenticated/unregistered prefix. Official prompts created staging; 157 files already matched, 5,163 files / 2,528,843,854 bytes were seeded, Connect finalized, all 5,320 final hashes matched, and profiled launch/lifecycle cleanup passed. This confirms the bridge but also confirms registration is not immediate: official per-product initialization remains required. Copy-on-write publication then reduced a controlled full 5,320-file / 2.55-GB same-filesystem seed benchmark to 6.3s plus 5.8s hash verification.
