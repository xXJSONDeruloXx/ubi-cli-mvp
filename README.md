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
- `ubi info <title-or-id>`
- `ubi manifest <title-or-id>`
- `ubi doctor`
- `ubi config show`

Current command strategy:

- auth/session: public HTTP session API.[2][9]
- account identity: `GET /v3/users/{userId}`.[6]
- library enumeration: public Ubisoft GraphQL library endpoint.[6][9]
- product metadata: live library data plus public `UplayManifests` datasets.[11][14][15]
- manifest inspection: public `UplayManifests` manifest hashes and raw fixtures, parsed with the public file-format parser approach from `ubisoft-demux-node`.[3][11][17][18]

## Validation status

High-level status:

- login/logout/me: **validated live**[19]
- list: **validated live** via GraphQL[19]
- info: **validated live/public-dataset mix**[19]
- manifest: **validated with public fixtures**[19]
- live Demux ownership/download-service retrieval: **blocked** in this environment[19]

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

### 4. Inspect a product

By owned title/product ID:

```bash
node dist/index.js info 720
node dist/index.js info "Assassin's Creed® Unity"
node dist/index.js info 720 --json
```

### 5. Inspect manifest metadata

```bash
node dist/index.js manifest 720
node dist/index.js manifest 46 --json
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

### `ubi list`

```text
Assassin's Creed® Unity | productId=720 | spaceId=6678eff0-1293-4f87-8c8c-06a4ca646068
For Honor | productId=569 | spaceId=c2294cd6-bd01-4f19-81e9-4e5d32cb763a
Rainbow Six® Extraction | productId=5271 | spaceId=c836bbda-7c0c-4b82-b0c2-b751b1843630
```

### `ubi manifest 46 --json`

The current MVP can return parsed manifest summaries from public fixtures, for example manifest version/chunk/file counts for a public `Far Cry® 3` fixture.[17][19]

## Architecture overview

The codebase is split into thin CLI commands, core auth/config/transport helpers, service-layer workflows, and normalized domain models.

Main directories:

- `src/cli/` — command definitions
- `src/core/` — config, session, HTTP, auth, Demux loader
- `src/services/` — library, product, manifest, public catalog services
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

1. The current MVP does **not** validate live Demux ownership enumeration or live download-service manifest URL retrieval; both remain blocked in this environment.[19]
2. `ubi list` uses the live GraphQL library endpoint rather than live Demux ownership because that is what validated end-to-end here.[6][9][19]
3. Public catalog mappings are incomplete, so some owned titles do not currently map to a known Ubisoft product ID and appear as `productId=unknown`.[14][19]
4. `ubi manifest` currently inspects public fixture data where available instead of live `.manifest/.metadata/.licenses` download-service responses.[5][11][17][19]

## Roadmap

See `docs/roadmap.md` for milestone tracking and the progress log.

## References

All numbered citations resolve in `docs/references.md`.
