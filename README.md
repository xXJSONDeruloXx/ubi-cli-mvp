# ubi-cli-mvp

A research-driven terminal CLI that behaves like a lightweight “Legendary for Ubisoft Connect”: log in, inspect your Ubisoft account, enumerate your library, inspect title metadata, and inspect manifest/build metadata where public evidence allows it.[1][2][4][5][6][9][11]

Repository: https://github.com/xXJSONDeruloXx/ubi-cli-mvp

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
- download planning: parsed public fixtures and live Demux manifests can estimate install/download size and largest files, and raw slice blobs can now be downloaded experimentally; the CLI still does not reconstruct those slices into installed game files.[3][5][19]

## Validation status

High-level status:

- login/logout/me: **validated live**[19]
- list/search: **validated live/public-catalog mix**[19]
- info: **validated live/public-dataset mix**[19]
- manifest/files/download-plan: **validated with public fixtures and with live Demux for owned titles**[19]
- demux-list/demux-info/download-urls/slice-urls: **validated live**[19][20]
- download-slices: **validated live for raw slice blob download**[19]
- addons: **validated against the public association graph**[19]

See `docs/validation.md` for exact commands, outcomes, and caveats.[19]

## Installation

Requirements:

- Node.js 22+
- npm 11+

Install:

```bash
npm install
npm run build
```

Optional local `.env` support is built in via `dotenv`. The repo ignores `.env`, and `.env.example` shows supported variables.

## Quickstart

### 1. Log in

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

### 11. Explore associated products / DLC-like entries

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

### `ubi download-slices 3539 --limit 1`

The current MVP can download **raw slice blobs** for an owned live build to disk after deriving slice paths from the parsed live manifest and requesting signed slice URLs from `download_service`.[3][5][19]

### `ubi extract-file 3539 'Support\Readme\English\Readme.txt'`

The current MVP can experimentally reconstruct at least some individual files from live slice payloads by downloading the file's required slices, decompressing them, validating decompressed slice SHA-1 values against manifest `slices[]` hashes when present, and writing them using either manifest-declared offsets or an implicit sequential fallback when the parsed `sliceList[].fileOffset` values are all protobuf-default zeroes. This has now been live-validated on both a one-slice Origins readme file and the multi-slice `d3dcompiler_47.dll`, but it is not yet a general-purpose installer/update path.[19]

### `ubi extract-files 3539 'Support\\Readme' --prefix --limit 3`

The current MVP can also experimentally reconstruct small batches of matching files from a live manifest. The batch extractor resolves slice URLs once for all matched files and reuses downloaded slice payloads across the batch when possible. This has been live-validated for multiple Origins readme files under `Support\Readme\...`, but it remains an exploratory workflow rather than a full installer/update engine.[19]

## Architecture overview

The codebase is split into thin CLI commands, core auth/config/transport helpers, service-layer workflows, and normalized domain models.

Main directories:

- `src/cli/` — command definitions
- `src/core/` — config, session, HTTP, auth, Demux loader/client
- `src/services/` — library, search, product, Demux, add-on, manifest, and public catalog services
- `src/models/` — normalized domain types
- `src/util/` — errors, logging, matching, Demux slice helpers
- `tests/` — unit and smoke tests
- `docs/` — research, architecture, roadmap, validation, references

See `docs/architecture.md` for the source-backed module rationale.[1][2][4][5][6][11]

## Security and storage

- credentials are never committed
- `.env` is ignored by git
- session artifacts are stored locally in the app data directory
- logs redact session secrets where possible
- this MVP currently uses local file storage rather than OS keychain integration, because the goal was to validate the research flow first.[2][9]

## Limitations

1. `ubi list` still uses the live GraphQL library endpoint rather than replacing it wholesale with Demux ownership output.[6][9][19]
2. Public-catalog product IDs do not always align 1:1 with Demux ownership product IDs, so cross-surface reconciliation still needs implementation work.[4][14][19]
3. Live Demux manifest inspection now works for owned products that expose a useful `latestManifest`, but not every entitlement row exposes one.[4][19]
4. The CLI can now parse live `.manifest`, `.metadata`, and `.licenses` assets, download raw slice blobs, and experimentally reconstruct some individual files from live slices, but it still does **not** reconstruct whole game installs.[3][5][19]
5. Download-service asset and slice exposure still varies by title, entitlement row, and file path; the current implementation gracefully handles missing live `.metadata`/`.licenses` URLs, and `extract-file` remains experimental rather than universally reliable for every manifest path.[4][5][19]
6. `ubi addons` currently exposes public associated products from the catalog graph; it does **not** prove those add-ons are owned by the authenticated account unless live Demux ownership reconciliation is applied.[4][12][19]

## Roadmap

See `docs/roadmap.md` for milestone tracking and the progress log.

## References

All numbered citations resolve in `docs/references.md`.
owned by the authenticated account unless live Demux ownership reconciliation is applied.[4][12][19]

## Roadmap

See `docs/roadmap.md` for milestone tracking and the progress log.

## References

All numbered citations resolve in `docs/references.md`.
solve in `docs/references.md`.
