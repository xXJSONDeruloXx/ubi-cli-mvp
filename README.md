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
3. some desired data, especially ownership/download-manifest flows, appears to depend on Demux behavior that is not currently validated end-to-end from this environment.[4][5][19]

## MVP scope

Implemented or partially implemented MVP commands:

- `ubi login`
- `ubi logout`
- `ubi me`
- `ubi list`
- `ubi search <text>`
- `ubi info <title-or-id>`
- `ubi manifest <title-or-id>`
- `ubi files <title-or-id>`
- `ubi download-plan <title-or-id>`
- `ubi addons <title-or-id>`
- `ubi doctor`
- `ubi config show`

Current command strategy:

- auth/session: public HTTP session API.[2][9]
- account identity: `GET /v3/users/{userId}`.[6]
- library enumeration: public Ubisoft GraphQL library endpoint.[6][9]
- title/product discovery: live library data plus public `UplayManifests` datasets and parsed product configs.[11][14][15]
- manifest inspection: public `UplayManifests` manifest hashes and raw fixtures, parsed with the public file-format parser approach from `ubisoft-demux-node`.[3][11][17][18]
- DLC/add-on exploration: public `ProductAssociations` graph data from `gamelist.json`, exposed as associated products rather than claimed owned entitlements.[12][19]
- download planning: parsed public manifest fixtures are used to estimate install/download size and largest files, but not to fetch live Ubisoft CDN URLs.[5][11][17][19]

## Validation status

High-level status:

- login/logout/me: **validated live**[19]
- list/search: **validated live/public-catalog mix**[19]
- info: **validated live/public-dataset mix**[19]
- manifest/files/download-plan: **validated with public fixtures**[19]
- addons: **validated against the public association graph**[19]
- live Demux transport/auth/ownership/download-service URL retrieval: **validated in repo experiments but not fully exposed in the CLI yet**[19][20]

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

Interactive:

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

By owned title/product ID:

```bash
node dist/index.js info 720
node dist/index.js info "Assassin's Creed® Unity"
node dist/index.js info 720 --json
```

### 6. Inspect manifest metadata

```bash
node dist/index.js manifest 720
node dist/index.js manifest 46 --json
```

### 7. Inspect manifest file contents and a dry-run download plan

```bash
node dist/index.js files 46 --limit 10
node dist/index.js download-plan 46
```

### 8. Explore associated products / DLC-like entries

```bash
node dist/index.js addons 720 --limit 10
node dist/index.js addons 720 --json
```

## Example outputs

### `ubi doctor`

```text
app: ubi-cli-mvp
node: v24.2.0
platform: darwin
cwd: /path/to/ubi-cli-mvp
config dir: /Users/you/Library/Preferences/ubi-cli-mvp
cache dir: /Users/you/Library/Caches/ubi-cli-mvp
data dir: /Users/you/Library/Application Support/ubi-cli-mvp
debug dir: /Users/you/Library/Application Support/ubi-cli-mvp/debug
config file: missing
session file: present
```

### `ubi list --search unity`

```text
Title                    Product ID   Variants  Space ID
-----------------------  ----------   --------  ------------------------------------
Assassin's Creed® Unity  720          2         6678eff0-1293-4f87-8c8c-06a4ca646068
```

### `ubi search "Far Cry 3" --json`

The current MVP can search public catalog titles to disambiguate product IDs and editions when `ubi info <title>` would otherwise be ambiguous.[12][15][19]

### `ubi download-plan 46`

The current MVP can return a dry-run install/download summary from a public manifest fixture, including estimated install bytes, compressed download bytes, and largest files for a known public `Far Cry® 3` fixture.[5][17][19]

## Architecture overview

The codebase is split into thin CLI commands, core auth/config/transport helpers, service-layer workflows, and normalized domain models.

Main directories:

- `src/cli/` — command definitions
- `src/core/` — config, session, HTTP, auth, Demux loader
- `src/services/` — library, search, product, add-on, manifest, and public catalog services
- `src/models/` — normalized domain types
- `src/util/` — errors, logging, matching helpers
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

1. Although Demux transport/auth/ownership/download-service URL retrieval now validate in repo experiments, the CLI still relies primarily on GraphQL/public-catalog paths until the Demux flows are fully wired and normalized.[19][20]
2. `ubi list` currently uses the live GraphQL library endpoint rather than the newly validated Demux ownership path.[6][9][19]
3. Public-catalog product IDs do not always align 1:1 with Demux ownership product IDs, so cross-surface reconciliation still needs implementation work.[4][14][19]
4. `ubi manifest`, `ubi files`, and `ubi download-plan` currently inspect public fixture data where available instead of live `.manifest/.metadata/.licenses` download-service responses.[5][11][17][19]
5. `ubi addons` currently exposes public associated products from the catalog graph; it does **not** prove those add-ons are owned by the authenticated account unless live Demux ownership reconciliation is applied.[4][12][19]

## Roadmap

See `docs/roadmap.md` for milestone tracking and the progress log.

## References

All numbered citations resolve in `docs/references.md`.
