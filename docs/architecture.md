# Architecture

## Stack choice

This MVP uses **TypeScript on Node.js LTS** with a thin CLI layer and explicit service boundaries.

### Rationale

- Public reverse-engineered Ubisoft resources already exist in Node/TypeScript form (`ubisoft-demux-node`), which reduces time-to-validation for Demux and manifest parsing.[1][2][3]
- The problem naturally splits into HTTP auth/session work and Demux socket/protobuf work, so strong TypeScript typing is useful to keep those boundaries explicit.[1][2][4][5]
- Community product/manifest datasets are JSON and YAML-like text, which are easy to consume from Node.[11][12][13][14][15]

## Module boundaries

### `src/cli/`

Thin commander-based command definitions.

Responsibilities:

- parse flags and arguments
- select output mode (human vs JSON)
- map errors to exit codes
- keep business logic out of command handlers

### `src/core/`

Cross-cutting runtime and protocol primitives.

Current modules:

- `config.ts`: resolve config/cache paths
- `session-store.ts`: read/write/redact session state
- `http.ts`: HTTP client, retries, timeouts, JSON helpers
- `auth-service.ts`: login, refresh, logout, me
- `demux-client.ts`: authenticated Demux patch negotiation, auth, ownership-service, and download-service interactions
- `ubisoft-demux-loader.ts`: runtime patching for the public Node package's proto resolution

Rationale: public sources show that HTTP sessions and Demux tickets are related but distinct concerns, so the repo keeps them in separate core components.[1][2][4][9]

### `src/services/`

Use-case-oriented workflows on top of the core layer.

Current modules:

- `library-service.ts`: owned titles via GraphQL plus normalization/deduping helpers; this remains the default user-facing list path.[6][9][19]
- `search-service.ts`: merge owned-library matches with public catalog matches to disambiguate product IDs, editions, and DLC-like entries.[12][14][15]
- `product-service.ts`: resolve a product by ID/name and hydrate metadata from live or public sources.[4][14][15]
- `demux-service.ts`: normalize live Demux ownership rows, reconcile them against public/catalog identifiers, obtain ownership tokens, request signed download-service URLs, derive slice paths, optionally download raw slice blobs for inspection, persist/reuse raw slice cache entries, and experimentally reconstruct individual files or small matching file batches from manifest slice metadata.[4][5][19][20]
- `addon-service.ts`: expose public associated products from the catalog graph for DLC exploration, without claiming ownership.[12][19]
- `manifest-service.ts`: fetch/parse manifests from public fixtures by default and from live Demux/download-service URLs when requested, deriving dry-run file/size summaries from either source.[3][5][13][17][18][19]
- `public-catalog-service.ts`: fetch/cache `UplayManifests` datasets and build searchable config/title indexes.[11][12][13][14][15]
- `ubisoft-connect.ts`: validate/cache the pinned official client installer, prepare explicit user-owned Wine prefixes, discover/start Connect, and run Wine-compatible child processes.
- `connect-seed.ts`: discover client-owned paused-download staging, enforce process/path/symlink safeguards, hash-compare reconstructed payloads, and atomically seed only mismatched staged files without modifying Connect metadata.
- `connect-profiles.ts`: atomically persist only non-secret product/source/prefix mappings in an owner-only local store.
- `connect-prefix.ts`: guarded same-machine prefix migration with explicit authentication-state acknowledgement, owner-only targets, no symlink dereference, and reflink-only defaults.

### `src/models/`

Normalized domain types independent of raw upstream payloads.

Current key types:

- `Session`
- `AccountIdentity`
- `LibraryItem`
- `SearchResult`
- `ProductInfo`
- `DemuxOwnedGame`
- `DemuxDownloadUrlsInfo`
- `DemuxSliceUrlsInfo`
- `DemuxSliceDownloadResult`
- `DemuxExtractedFileResult`
- `DemuxExtractedFilesResult`
- `AddonInfo`
- `ManifestInfo`
- `DownloadPlan`

Rationale: raw reverse-engineered payloads are unstable, so commands should speak in stable internal models.[1][4][6]

### `src/util/`

Helpers that do not belong to transport or domain logic.

Current modules include:

- `logger.ts`
- `errors.ts`
- `matching.ts`
- `demux-slices.ts`
- `manifest-paths.ts`

## Data flow

### Login flow

1. CLI collects credentials or uses environment/config input.
2. `AuthService` creates a session through `POST /v3/profiles/sessions`.[2]
3. On success, `SessionStore` persists the session ticket, session ID, expiry, remember-me ticket, and user ID.[2][9]
4. Later commands call `ensureValidSession()`, which tries `PUT /v3/profiles/sessions` refresh first and remember-me refresh second.[9]

### `ubi list`

1. Load/refresh session.
2. Call GraphQL `viewer.games` via the public HTTP API.[6][9]
3. Enrich the results with public catalog lookups.
4. Optionally dedupe variant rows into a friendlier summary view.

### `ubi demux-list` / `ubi demux-info <query>`

1. Load/refresh the public HTTP session.
2. Open a TLS 1.2 Demux socket.
3. Send `getPatchInfoReq`, then push `clientVersion = latestVersion`, then authenticate with the HTTP session ticket.[19][20]
4. Open `ownership_service` and send `initializeReq` with the session ticket and session ID.[4]
5. Normalize owned products into stable internal models and reconcile them against public product IDs via `SpaceId`, `AppId`, and exact-title fallbacks.[14][15][19]

### `ubi download-urls <query>`

1. Resolve an owned Demux product.
2. Obtain an ownership token from `ownership_service`.[4]
3. Open `download_service` with that token.[5]
4. Request signed URLs for `.manifest`, `.metadata`, and `.licenses` assets when available.[5][19]

### `ubi manifest <query> --live` / `ubi files <query> --live` / `ubi download-plan <query> --live`

1. Resolve an owned Demux product.
2. Obtain an ownership token and signed manifest URL via `download_service`.[4][5]
3. Fetch the live `.manifest` bytes over HTTP.
4. Parse the manifest with the documented file parser approach.[3]
5. Derive file lists and dry-run byte totals from the current owned build.[19]

### `ubi manifest <query> --live --with-assets`

1. Resolve an owned Demux product and request live asset URLs from `download_service`.[4][5]
2. Extract `.manifest`, `.metadata`, and `.licenses` URLs even when Demux returns them as alternates under one manifest-path response row.[19]
3. Fetch each available asset over HTTP.
4. Parse the extra metadata/license payloads with the documented parser entrypoints.[3]
5. Surface metadata byte totals and license identifiers/languages alongside the manifest summary.

### `ubi slice-urls <query>`

1. Parse the live owned manifest.
2. Derive CDN slice paths from manifest `sliceList[].downloadSha1` values.[19]
3. Ask `download_service` for signed URLs for a limited set of those slice paths.[5]

### `ubi download-slices <query>`

1. Derive signed slice URLs from the current owned manifest.
2. Fetch raw slice blobs to disk.
3. Persist each raw slice under the local cache directory by slice hash when cache paths are available.
4. Reuse cached slice blobs on later runs when the same slice hash is requested again.
5. Explicitly stop short of reconstructing final installed game files.

### `ubi extract-file <query> <manifest-path>`

1. Parse the live owned manifest.
2. Resolve one exact manifest file path from the parsed file table.
3. Request signed URLs for just that file's needed slices.
4. Reuse cached raw slices when available; otherwise fetch them and add them to the local cache.
5. Decompress known zstd-framed or zlib-framed slice payloads and write them at the manifest-declared offsets, with a sequential-offset fallback for all-zero protobuf-default offset lists.
6. Produce one experimental reconstructed file on disk without claiming full installer/update-engine support.

### `ubi download-game <query>`

1. Parse the live owned manifest.
2. Select a bounded file set by default; require explicit `--all --yes` for the full manifest.
3. SHA-256-verify resume-state entries before deciding which files still need slices.
4. Derive one deterministic CDN path per needed slice and resolve signed URLs through reused per-product Demux initialization.
5. Fetch/decompress slices and publish contained output files through synced atomic renames.
6. Persist manifest-bound SHA-256 resume metadata and retain signed-URL refresh as a fallback.

### `ubi connect-seed <install-directory>`

1. Require an explicit Wine prefix and numeric Connect product ID.
2. Confirm `upc.exe` is not running and read the product install path registered by the official client.
3. Require Connect-created `uplay_install.state` and `uplay_download/<productId>` staging markers; never create or edit them.
4. Reject source symlinks and destination traversal/symlink paths.
5. SHA-256-compare every reconstructed source file with its staged counterpart.
6. In `--dry-run`, report matching and mismatched files/bytes without writing.
7. With explicit `--yes`, copy only mismatches through synced atomic temporary-file renames.
8. With `--finalize`, restart Connect and wait until its official install manifest exists and product staging is removed; with `--launch`, then invoke the registered product URI.
9. Keep authoritative verification, finalization, entitlement, and DRM handling inside Connect.

### Guided Connect launch

1. Require an explicit Wine prefix so the default prefix is never modified unexpectedly.
2. Discover Connect or, with `--ensure-connect --yes`, download the exact pinned installer from its constrained official HTTPS endpoint and validate SHA-256 plus PE certificate-table structure before execution.
3. Keep first credential/MFA entry in the official client UI; never transfer the CLI web session.
4. After official install finalization, invoke `uplay://launch/<productId>/0` when `--connect-product-id` is supplied, allowing Connect to perform its normal launch/entitlement path without a Play-button click.
5. `connect-install <productId>` can invoke the supported `uplay://install/<productId>` handler to open Connect's official first-install confirmations without library navigation; the CLI does not synthesize confirmation clicks.
6. `connect-profile` stores non-secret product/prefix paths, and `play <productId>` resolves that profile, invokes the launch URI, monitors the profiled game process through Wine, then stops Connect after game exit to avoid residual launcher/promotional UI.

### Public/fallback manifest path

1. Resolve known manifest hashes from `manifestlist.json`.[13]
2. If a public raw fixture exists, parse it locally for fixture-based validation.[17][18]
3. Derive file lists and dry-run byte totals from the parsed fixture when requested.[3][17][19]
4. Otherwise report that only manifest-hash inspection is currently available.

## Error handling model

The repo uses typed, user-facing error classes.

### Error categories

- `ConfigError`: broken config/session files
- `AuthError`: login, refresh, 2FA, or missing-session issues
- `TransportError`: HTTP timeout/network failure/Demux timeout
- `ProtocolError`: unexpected upstream response shape
- `ResolutionError`: product/title could not be matched
- `ValidationError`: command completed partially but cannot claim full success

### Policy

- Human output goes to stdout; logs and diagnostics go to stderr.
- Sensitive fields (`ticket`, `rememberMeTicket`, `sessionId`, passwords, raw auth headers, ownership tokens) are redacted or omitted from default human output.
- Commands return partial data only when clearly labeled as partial.
- Demux timeouts are translated into actionable guidance because public Demux references explicitly note that protocol mistakes often surface as timeouts rather than structured errors.[1]

## Storage model

Default path: platform-specific user config/data/cache directories via `env-paths`, under `ubi-cli-mvp/`.

Files:

- `config.json`: non-secret settings such as app IDs, verbosity defaults, and cache settings
- `session.json`: persisted session metadata and tickets (redacted in logs)
- `cache/*.json`: cached public dataset snapshots from `UplayManifests`
- `cache/demux-slices/*.slice`: cached raw Demux slice payloads keyed by slice hash
- `connect-profiles.json`: mode-0600 non-secret product/source/prefix mappings for `ubi play`
- user-selected Wine prefixes: contain sensitive official-client remembered authentication and must remain owner-only; they are never stored in the repository
- `debug/*`: optional raw manifest and Demux-related artifacts written during inspection flows

## Current blocker frontier

The repo is no longer blocked on basic Demux connectivity.

The remaining frontier is the gap between **raw manifest/slice retrieval** and a true **installer/update engine**:

- public/catalog product IDs do not always align 1:1 with Demux ownership product IDs
- not every entitlement row exposes a usable `latestManifest`
- complete reconstruction plus Connect staging/finalization is validated for one owned legacy title/build, but other titles may use different payload, staging, prerequisite, or registration semantics
- first-time Connect authentication/MFA and one official Download initiation remain interactive because no supported unattended credential or install-initiation API has been established
- one persistent shared prefix safely reuses remembered authentication; whole-prefix cloning works on the same machine but token rotation makes it a one-way migration rather than a parallel template
- update/repair orchestration and automatic product-ID/profile selection remain incomplete
