# ubi-cli-mvp

A research-driven terminal CLI that behaves like a lightweight “Legendary for Ubisoft Connect”: log in, inspect your Ubisoft account, enumerate your library, inspect title metadata, inspect manifest/build metadata, and progressively move toward real selective download/install workflows where public evidence allows it.[1][2][4][5][6][9][11]

Repository: https://github.com/xXJSONDeruloXx/ubi-cli-mvp

## Product inspiration / north star

This project is intentionally aiming at the same general category of tooling as:

- **Legendary** for Epic Games Store
- **Heroic** as a friendlier launcher/UI around store CLIs and install workflows
- **Nile** for Amazon Games / Prime Gaming-style entitlement and download management

For Ubisoft Connect, the desired end state is similar in spirit:

- account auth and refresh
- owned-library discovery and filtering
- title metadata and manifest/build inspection
- selective download/extraction primitives
- eventually install / update / repair / import-style workflows

This repo is not at feature parity with any of those projects today; they are product inspiration, not a claim of compatibility.

## Why this problem is hard

Ubisoft Connect is not backed by a single clean public API. Public reverse-engineering points to at least two relevant surfaces:

- the public HTTP API on `public-ubiservices.ubi.com`; and
- a launcher-oriented socket/protobuf “Demux” protocol used for ownership and download workflows.[1]

That makes this project difficult for three reasons:

1. public behavior is partly documented and partly inferred from reverse-engineered clients, not official docs.[1][2][4][5]
2. auth/session behavior can drift over time, including challenge and refresh behavior.[2][9][16]
3. the remaining gap is no longer basic connectivity, but bridging public/catalog data, Demux ownership data, and actual installer/update behavior honestly.[4][5][19][20]

## MVP scope

Implemented or partially implemented commands:

- `ubi setup`
- `ubi login`
- `ubi logout`
- `ubi me`
- `ubi list`
- `ubi search <text>`
- `ubi info <title-or-id>`
- `ubi demux-list`
- `ubi demux-info <query>`
- `ubi manifest <title-or-id>`
- `ubi files <title-or-id>`
- `ubi download-plan <title-or-id>`
- `ubi download-urls <query>`
- `ubi slice-urls <query>`
- `ubi download-slices <query>`
- `ubi extract-file <query> <manifest-path>`
- `ubi extract-files <query> <path-filter>`
- `ubi download-game <query>`
- `ubi run <install-directory>`
- `ubi play <product-id>`
- `ubi connect-install <product-id>`
- `ubi connect-profile ...`
- `ubi connect-prefix clone ...`
- `ubi connect-prefix migrate-auth ...`
- `ubi connect-seed <install-directory>`
- `ubi addons <title-or-id>`
- `ubi doctor`
- `ubi config show`

Current command strategy:

- auth/session: public HTTP session API.[2][9]
- account identity: `GET /v3/users/{userId}`.[6]
- library enumeration: public Ubisoft GraphQL library endpoint plus dedicated Demux ownership enumeration for richer owned-product metadata.[4][6][9][19][20]
- title/product discovery: live library data plus public `UplayManifests` datasets and parsed product configs.[11][14][15]
- manifest inspection: public `UplayManifests` raw fixtures by default, with live Demux/download-service retrieval available for owned products that expose a `latestManifest`.[3][5][11][17][18][19]
- DLC/add-on exploration: public `ProductAssociations` graph data plus Demux-owned entitlement rows for richer ownership inspection.[4][12][19]
- download planning and extraction: parsed public fixtures and live Demux manifests can estimate install/download size and largest files; raw slice blobs can be downloaded, cached locally, and experimentally reconstructed into some individual files or small matching file batches.[3][5][19]

## Validation status

High-level status:

- setup/check: **validated live against an installed authenticated shared prefix without launching Connect**[19]
- login/logout/me: **validated live**[19]
- list/search: **validated live/public-catalog mix**[19]
- info: **validated live/public-dataset mix**[19]
- manifest/files/download-plan: **validated with public fixtures and with live Demux for owned titles**[19]
- demux-list/demux-info/download-urls/slice-urls: **validated live**[19][20]
- download-slices: **validated live for raw slice blob download with local cache reuse support**[19]
- extract-file/extract-files: **validated live, still experimental**[19]
- addons: **validated against the public association graph**[19]

See `docs/validation.md` for exact commands, outcomes, and caveats.[19]

## Progress tracker

### Done

- [x] one-command shared-prefix/client setup plus offline remembered-auth inspection
- [x] direct Ubisoft session login, refresh, logout, and `me`
- [x] live library listing and title/product search
- [x] public-catalog and product-config enrichment
- [x] live Demux patch negotiation, auth, ownership enumeration, and ownership-token retrieval
- [x] live signed `.manifest`, `.metadata`, and `.licenses` URL retrieval
- [x] manifest/file/download-plan inspection from both public fixtures and live owned manifests
- [x] slice URL derivation and raw slice download
- [x] experimental single-file extraction from live slices
- [x] experimental batch extraction for small matching file sets
- [x] local slice-cache reuse across repeated extraction/download workflows

### In progress

- [~] validating reconstruction behavior across more file classes, titles, and build layouts
- [~] growing from file-by-file extraction into something closer to a resumable downloader/install pipeline
- [~] improving operator ergonomics with better path filtering, progress reporting, and clearer capability boundaries

### TODO / target capabilities

- [ ] expose or reconstruct install-state/update-state concepts where the format and live service behavior are sufficiently understood
- [ ] selective chunk/language/DLC download planning beyond simple file-path filtering
- [ ] resumable multi-command downloader behavior with stronger cache/index metadata
- [ ] install/import/export/repair-style workflows inspired by Legendary/Heroic/Nile UX expectations
- [ ] broader live validation across more Ubisoft titles and entitlement shapes

### Known unknowns

- whether every file class and title can be reconstructed with the current zstd + slice-offset model
- whether some files/builds require extra delta, patch, or transform logic beyond what is currently implemented
- how Ubisoft expects install/update/resume state to be orchestrated around manifests, languages, DLC, and branches
- how far public catalog IDs and Demux ownership IDs can be reconciled automatically without user help in edge cases

## Installation

Requirements:

- Node.js 22+
- npm 11+
- a Wine-compatible runner for `setup`, Connect integration, and Windows game launch

Install:

```bash
npm install
npm run build
```

Optional local `.env` support is built in via `dotenv`. The repo ignores `.env`, and `.env.example` shows supported variables.

## Quickstart

### Recommended: one-time setup

```bash
node dist/index.js setup
```

`setup` reuses or creates the CLI session, creates one owner-only shared Wine prefix, asks before downloading/installing the pinned official Connect client, records pinned-installer or explicit-trust provenance, saves that prefix as the default, and opens the official client only when remembered desktop authentication is absent during an interactive run. Use `--yes` to pre-authorize client installation, `--no-launch-connect` to configure without opening it, or explicit `--allow-connect-launch` when a JSON/noninteractive caller really wants the GUI. A safe client installed outside this setup flow requires explicit one-time `--trust-existing-connect` before setup will launch it.

Check setup without launching Connect:

```bash
node dist/index.js setup --check
node dist/index.js setup --check --json
node dist/index.js setup --check --strict
```

After normal CLI app-directory initialization, the checker only inspects validated local state and does not contact Ubisoft or start Wine/Connect. `setupStatus: locally-ready` means the CLI session is structurally safe, the prefix/client provenance is configured, and expected opaque secure storage, user state, and ownership-cache evidence exist. It is **offline evidence**, not proof that Ubisoft has not expired or revoked the client session; only an actual official-client connection can establish current server validity.

### 1. Log in manually (alternative)

```bash
node dist/index.js login
```

Optional `.env` / environment variables:

```bash
UBI_EMAIL=you@example.com
UBI_PASSWORD=...
UBI_2FA_CODE=...
```

The CLI stores session state under the resolved app data directory shown by `ubi doctor` / `ubi config show`.

### 2. Inspect the account

```bash
node dist/index.js me
node dist/index.js me --json
```

### 3. List the library

```bash
node dist/index.js list
node dist/index.js list --json
```

### 4. Search for games, editions, or DLC-like catalog entries

```bash
node dist/index.js search unity
node dist/index.js search "Far Cry 3" --json
```

### 5. Inspect a product

```bash
node dist/index.js info 720
node dist/index.js info "Assassin's Creed® Unity"
node dist/index.js info 720 --json
```

### 6. Inspect Demux-owned products directly

```bash
node dist/index.js demux-list --search origins
node dist/index.js demux-info 3539
```

### 7. Inspect manifest metadata

```bash
node dist/index.js manifest 720
node dist/index.js manifest 46 --json
node dist/index.js manifest 3539 --live
node dist/index.js manifest 3539 --live --with-assets
```

### 8. Inspect manifest file contents and a dry-run download plan

```bash
node dist/index.js files 46 --limit 10
node dist/index.js files 3539 --live --limit 10
node dist/index.js files 3539 --live --match 'Support\\Readme' --prefix --limit 5
node dist/index.js download-plan 46
node dist/index.js download-plan 3539 --live
node dist/index.js download-plan 3539 --live --match 'Support\\Readme' --prefix
```

### 9. Inspect live signed Demux download URLs and slice URLs

```bash
node dist/index.js download-urls 3539
node dist/index.js slice-urls 3539 --limit 5
```

### 10. Experimentally download raw slice payloads

```bash
node dist/index.js download-slices 3539 --limit 1 --output-dir /tmp/ubi-slice-download-test
```

### 11. Experimentally reconstruct one file or a small matching batch

```bash
node dist/index.js extract-file 3539 'Support\\Readme\\English\\Readme.txt' --output /tmp/ubi-extract/Readme.txt
node dist/index.js extract-files 3539 'Support\\Readme' --prefix --limit 3 --output-dir /tmp/ubi-extract-batch-live
```

### 12. Plan or reconstruct a game tree safely

`download-game` is bounded to 10 files and 1 GiB by default. Start with a dry run, then use explicit limits. A whole-game run requires `--all --yes`.

```bash
node dist/index.js download-game 3539 --dry-run
node dist/index.js download-game 3539 --limit 5 --max-install-bytes 524288000 --output-dir /tmp/ubi-game
node dist/index.js download-game 109 --all --yes --output-dir /games/splinter-cell
```

Completed files are recorded in a manifest-bound, SHA-256-verified local resume state. Use `--restart` only when deliberately replacing incompatible state. In live validation, an owned 5,320-file / 2.55-GB Splinter Cell tree first completed in 5m49s after deterministic CDN-path optimization. A later clean-cache run completed in 2m55s with 5,844 network fetches, zero cache hits, and zero URL refreshes; a second pass SHA-256-verified every output in 10s with zero network transfer.

### 13. Launch a reconstructed Windows game

On Linux, `run` uses `wine` by default; on Windows it launches the selected executable directly. The child starts in the executable's directory so adjacent DLL/config/asset lookups work. Start with `--dry-run`; when a tree contains several executables, pass one explicitly.

```bash
node dist/index.js run /games/splinter-cell --dry-run
node dist/index.js run /games/splinter-cell --executable system/SplinterCell.exe
```

For Ubisoft Store builds that require the desktop client, use an explicit prefix. `--connect` starts the official client and pauses for the user to complete its first authentication. `--ensure-connect --yes` may download and silently install a pinned official installer; `--connect-installer` accepts the same pinned file for offline reuse. The CLI verifies the exact SHA-256 and PE Authenticode certificate-table structure before execution.

```bash
node dist/index.js run /games/splinter-cell \
  --executable system/SplinterCell.exe \
  --wine-prefix ~/.local/share/ubi/prefixes/splinter-cell \
  --ensure-connect --yes
```

Connect did not expose a reliable **Locate installed game** path for the validated legacy build. Instead, start its official Download once, wait until transfer begins, pause it, and fully exit Connect. `connect-seed` then discovers the product registration created by Connect, refuses to run while the client is active, validates the official staging markers, SHA-256-compares every payload file, and atomically seeds only mismatches. Publication requests same-filesystem copy-on-write clones with safe full-copy fallback. It never changes Connect's registry, state, or manifest files.

```bash
node dist/index.js connect-seed /games/splinter-cell \
  --wine-prefix ~/.local/share/ubi/prefixes/splinter-cell \
  --product-id 109 --dry-run
node dist/index.js connect-seed /games/splinter-cell \
  --wine-prefix ~/.local/share/ubi/prefixes/splinter-cell \
  --product-id 109 --yes --finalize
```

`--finalize` restarts Connect and waits for its official verification to publish `uplay_install.manifest` and remove product staging; the validated client resumed automatically. Add `--launch` to invoke the registered game URI immediately after successful finalization. Once Connect shows **Play**, future launches can avoid the Play button by using the same registered `uplay://` protocol:

```bash
node dist/index.js run /games/splinter-cell \
  --executable system/SplinterCell.exe \
  --wine-prefix ~/.local/share/ubi/prefixes/splinter-cell \
  --connect --connect-ready --connect-product-id 109
```

Credential entry, MFA, entitlement, initial download-state creation, and final verification remain inside Ubisoft Connect. The CLI never transfers its web session, submits desktop credentials, substitutes DLLs, or fabricates Connect registry/database state. `--runner-arg` is repeatable for runners that need arguments before the executable.

### 14. Save a shared Connect prefix and use `ubi play`

A single persistent Connect prefix is the safest way to reuse the official client's remembered authentication across games. Profiles store only non-secret product IDs and paths in an owner-only (`0600`) local file—never client tokens or credentials.

```bash
node dist/index.js connect-profile default ~/.local/share/ubi/prefixes/connect
node dist/index.js connect-profile set 109 \
  --install-dir /games/splinter-cell \
  --executable system/SplinterCell.exe
node dist/index.js play 109
```

`play` invokes the official product URI, waits for the profiled game process, and stops Connect after the game exits so its launcher/promotional UI is not left open. Use `--leave-connect-open` to opt out or `--dry-run` to inspect the command.

For an uninstalled owned product, `connect-install <productId>` invokes the supported `uplay://install/<productId>` handler and opens its official language/path confirmation directly, avoiding library navigation. Authentication and confirmations remain inside Connect; the CLI does not synthesize clicks or begin transfer itself.

```bash
node dist/index.js connect-install 82
```

The CLI's public Ubisoft session cannot be converted into Connect desktop authentication: the CLI does not retain the password, and no supported ticket/device-code handoff into `UbisoftConnect.exe` is known. Connect keeps its own opaque encrypted client profile bound to the Wine device identity.

For a stopped, existing destination prefix, `migrate-auth` can perform a guarded same-machine **one-way migration** of only the official Connect AppData profile and its matching Wine device identifier. It never decodes or prints the authentication state and does not copy game registration. Live validation showed a genuinely fresh prefix regenerate ownership state without a login UI. Starting the target may rotate authentication and invalidate the source, so retire the source afterward:

```bash
node dist/index.js connect-prefix migrate-auth /old/prefix /fresh/prefix \
  --include-auth --yes
```

A whole-prefix migration remains available when installation/registration state must move too. It defaults to reflink-only cloning, creates an owner-only (`0700`) target, and refuses to merge into an existing prefix:

```bash
node dist/index.js connect-prefix clone /old/prefix /new/prefix \
  --include-auth --yes
```

Only one prefix in an authentication lineage should remain active. Prefer one shared persistent prefix instead of repeatedly migrating or cloning.

### 15. Explore associated products / DLC-like entries

```bash
node dist/index.js addons 720 --limit 10
node dist/index.js addons 720 --json
```

## Example outputs

### `ubi list --search unity`

```text
Title                    Product ID   Variants  Space ID
-----------------------  ----------   --------  ------------------------------------
Assassin's Creed® Unity  720          2         6678eff0-1293-4f87-8c8c-06a4ca646068
```

### `ubi demux-info 3539`

The current MVP can expose live Demux ownership metadata such as the Demux product ID, reconciled public product ID, active branch, latest live manifest hash, and product associations for an owned title like `Assassin's Creed® Origins`.[4][19][20]

### `ubi download-plan 3539 --live`

The current MVP can return a dry-run install/download summary from a **live** Demux manifest for an owned product, including install bytes, compressed download bytes, and the largest files in the current build.[3][5][19]

### `ubi download-plan 3539 --live --match 'Support\\Readme' --prefix`

The current MVP can also derive a **filtered** dry-run plan for a path-scoped subset of the live manifest file list. This is still file-based rather than chunk-membership-based, so filtered plans omit `chunkCount`, but it is already useful for estimating targeted extraction/download experiments.[19]

### `ubi download-slices 3539 --limit 1`

The current MVP can download **raw slice blobs** for an owned live build to disk after deriving slice paths from the parsed live manifest and requesting signed slice URLs from `download_service`. Downloaded slices are also persisted under the local cache directory by slice hash when cache paths are available, so repeated workflows can avoid re-downloading the same raw blob.[3][5][19]

### `ubi extract-file 3539 'Support\Readme\English\Readme.txt'`

The current MVP can experimentally reconstruct at least some individual files from live slice payloads by downloading the file's required slices, decompressing them, validating decompressed slice SHA-1 values against manifest `slices[]` hashes when present, and writing them using either manifest-declared offsets or an implicit sequential fallback when the parsed `sliceList[].fileOffset` values are all protobuf-default zeroes. This has now been live-validated on both a one-slice Origins readme file and the multi-slice `d3dcompiler_47.dll`, but it is not yet a general-purpose installer/update path.[19]

### `ubi extract-files 3539 'Support\\Readme' --prefix --limit 3`

The current MVP can also experimentally reconstruct small batches of matching files from a live manifest. The batch extractor resolves slice URLs once for all matched files and reuses downloaded slice payloads across the batch when possible. This has been live-validated for multiple Origins readme files under `Support\Readme\...`, but it remains an exploratory workflow rather than a full installer/update engine.[19]

### `ubi download-game 109 --dry-run`

`download-game` can plan or reconstruct an owned game tree. Its default 10-file / 1-GiB bound, output-path containment checks, free-space preflight, atomic file publication, interrupt handling, and manifest-bound SHA-256 resume state make it suitable for controlled reconstruction runs. It deliberately requires `--all --yes` to opt into a whole manifest. URL lookup uses each slice hash's deterministic CDN prefix rather than probing all 32 prefixes; a clean-cache 5,320-file / 2.55-GB Splinter Cell run completed in 2m55s, and a full verified resume pass took 10s with zero downloaded bytes.[19]

## Architecture overview

The codebase is split into thin CLI commands, core auth/config/transport helpers, service-layer workflows, and normalized domain models.

Main directories:

- `src/cli/` — command definitions
- `src/core/` — config, session, HTTP, auth, Demux loader/client
- `src/services/` — library, search, product, Demux, add-on, manifest, and public catalog services
- `src/models/` — normalized domain types
- `src/util/` — errors, logging, matching, Demux slice helpers, manifest-path filtering helpers
- `tests/` — unit and smoke tests
- `docs/` — research, architecture, roadmap, validation, references

See `docs/architecture.md` for the source-backed module rationale.[1][2][4][5][6][11]

## Security and storage

- credentials are never committed
- `.env` is ignored by git
- session artifacts are stored locally in the app data directory
- raw slice cache entries are stored locally under the cache directory by slice hash
- `login --json` redacts ticket, session, and remember-me values
- session files are schema/size/ownership validated, opened without symlink following, serialized across processes, and atomically written with owner-only permissions; legacy regular files are restricted through their open handle when loaded
- resume state stores manifest/output identifiers and completed-file SHA-256 values only; it never stores signed URLs or session values
- verbose HTTP logs redact URL query strings, including signed-URL parameters
- this MVP currently uses local file storage rather than OS keychain integration, because the goal was to validate the research flow first.[2][9]
- Ubisoft credential/configuration environment variables are stripped from all Wine/runner child environments, so `.env` passwords and MFA values are never inherited by the installer, Connect, or games
- setup-installed clients receive an owner-only provenance marker tied to the pinned installer; a safe pre-existing client requires explicit `--trust-existing-connect` before setup will launch it
- Wine prefixes containing remembered Connect authentication are sensitive and owner-only; `migrate-auth` copies only opaque official client AppData plus its device binding, never prints either, and requires explicit `--include-auth --yes`
- authenticated prefix migration is one-way: starting the target may rotate the client session and invalidate the source, which must then be retired

## Limitations

1. `ubi list` still uses the live GraphQL library endpoint rather than replacing it wholesale with Demux ownership output.[6][9][19]
2. Public-catalog product IDs do not always align 1:1 with Demux ownership product IDs, so cross-surface reconciliation still needs implementation work.[4][14][19]
3. Live Demux manifest inspection now works for owned products that expose a useful `latestManifest`, but not every entitlement row exposes one.[4][19]
4. The CLI can now parse live `.manifest`, `.metadata`, and `.licenses` assets, download raw slice blobs, persist raw slice cache entries, and experimentally reconstruct some individual files, small matching file batches, or even a full game tree over multiple runs, but it still does **not** provide a launcher-grade install/update engine.[3][5][19]
5. Download-service asset and slice exposure still varies by title, entitlement row, compression format, and file path; the current implementation gracefully handles missing live `.metadata`/`.licenses` URLs, but `extract-file`, `extract-files`, and `download-game` remain experimental rather than universally reliable for every manifest path or title.[4][5][19]
6. Long-running full-game runs can still surface upstream service instability or title-specific formats. Deterministic slice paths made the validated 2.55-GB run fit comfortably within the observed signed-URL lifetime, while 403 refresh remains a fallback. The CLI performs bounded preflight by default and supports interrupt-driven cancellation, but it is not a launcher-grade installer or updater.[19]
7. `ubi run` can bootstrap/start a pinned official Ubisoft Connect build; `connect-prefix migrate-auth` can one-way reuse an official remembered login; `connect-seed` can populate client-owned staging without fabricating registration; and profiled `ubi play` can launch through `uplay://`, monitor the game, and close Connect afterward. The first-ever desktop authentication/MFA and each never-initialized product's official language/options/EULA/registration flow remain Connect operations. A reconstructed tree cannot safely register itself immediately. Controller mappings and per-game runtime settings remain out of scope.
8. `ubi addons` currently exposes public associated products from the catalog graph; it does **not** prove those add-ons are owned by the authenticated account unless live Demux ownership reconciliation is applied.[4][12][19]

## Roadmap

See `docs/roadmap.md` for milestone tracking and the progress log.

## References

All numbered citations resolve in `docs/references.md`.
