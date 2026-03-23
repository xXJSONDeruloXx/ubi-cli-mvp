# Validation

## Environment

- Date: 2026-03-23
- OS: macOS 15.6.1 (24G90)
- Node.js: v24.2.0
- npm: 11.3.0
- Repository: `xXJSONDeruloXx/ubi-cli-mvp`
- Authentication method used for live validation: direct session login against Ubisoft's public session API with credentials supplied locally via `.env`; credentials and session artifacts were not committed and are redacted from this document.[2][9]

## Validation summary

| Capability                               | Status                              | Evidence                                                                                                                                                            | How to reproduce                                              | Notes                                                                                                                                                                                                                                                  |
| ---------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ubi doctor`                             | validated live                      | Command returned resolved config/data/cache/debug paths and session presence locally.                                                                               | `node dist/index.js doctor --json`                            | Local-only check; no Ubisoft network dependency.                                                                                                                                                                                                       |
| `ubi config show`                        | validated live                      | Command printed the resolved app IDs and filesystem paths used by the CLI.                                                                                          | `node dist/index.js config show`                              | Local-only check.                                                                                                                                                                                                                                      |
| `ubi login`                              | validated live                      | Direct login succeeded with the HTTP session flow from public reverse-engineering references.[2][9]                                                                 | `node dist/index.js login`                                    | **Experimentally observed in this repo:** the default direct-login `Ubi-AppId` needed to be `f68a4bb5-608a-4ff2-8123-be8ef797e0a6`; blank `.env` overrides caused a misleading “Ubi-AppId header is missing” error until blank env handling was fixed. |
| `ubi logout`                             | validated live                      | Local session file was removed and login was re-run successfully afterwards.                                                                                        | `node dist/index.js logout` then `node dist/index.js login`   | Logout is local state deletion only.                                                                                                                                                                                                                   |
| `ubi me`                                 | validated live                      | Command returned a live account identity (`source: live`) from `GET /v3/users/{userId}`.[6]                                                                         | `node dist/index.js me` or `node dist/index.js me --json`     | Personally identifying fields are omitted from this document but were returned by the command during validation.                                                                                                                                       |
| `ubi list`                               | validated live                      | Live GraphQL library query returned 27 titles for the validated account.[6][9]                                                                                      | `node dist/index.js list` or `node dist/index.js list --json` | 11 of 27 validated titles mapped to public product IDs via `productservice.json`; the rest remained `productId=unknown`, which reflects gaps in the public mapping dataset rather than command failure.[14]                                            |
| `ubi info 720`                           | validated live / public dataset mix | Returned `Assassin's Creed® Unity` with `sources.library=true` and `sources.publicCatalog=true`.                                                                    | `node dist/index.js info 720 --json`                          | Uses live library resolution plus public catalog/config data.[14][15]                                                                                                                                                                                  |
| `ubi info 46`                            | validated with public dataset       | Returned public metadata for product 46 (`Far Cry® 3`) including one known manifest hash and parsed config summary.                                                 | `node dist/index.js info 46 --json`                           | Does not require ownership when resolving by public product ID.                                                                                                                                                                                        |
| `ubi manifest 720`                       | validated with public fixture       | Returned `status: parsed-public-fixture` and parsed manifest summary (`chunkCount: 39`, `fileCount: 482`) using a public raw fixture from `UplayManifests`.[11][17] | `node dist/index.js manifest 720 --json`                      | Resolution used a live owned title, but manifest bytes came from the public GitHub fixture rather than a live Ubisoft download-service session.                                                                                                        |
| `ubi manifest 46`                        | validated with public fixture       | Returned `status: parsed-public-fixture` for product 46 and parsed a public raw fixture with manifest version 3.[11][17]                                            | `node dist/index.js manifest 46 --json`                       | Demonstrates reproducible manifest parsing even without ownership.                                                                                                                                                                                     |
| Manifest parser fixture test             | validated with fixture              | `tests/manifest-parser.test.ts` parsed the committed public raw fixture and asserted version/compression/chunk/file counts.[3][17][18]                              | `npm test -- --run tests/manifest-parser.test.ts`             | Stable regression coverage for manifest parsing.                                                                                                                                                                                                       |
| Auth/session logic tests                 | validated with tests                | `tests/auth-service.test.ts` covers challenge retry, 2FA response handling, and remember-me refresh.                                                                | `npm test -- --run tests/auth-service.test.ts`                | Uses mocked HTTP responses, not live Ubisoft sessions.                                                                                                                                                                                                 |
| Demux ownership enumeration              | blocked                             | Public source request shapes exist,[1][4] but live Demux connectivity failed in this environment.                                                                   | See blocker reproduction below.                               | The MVP therefore uses GraphQL for library enumeration instead of live Demux.                                                                                                                                                                          |
| Live download-service manifest retrieval | blocked                             | Public source request shapes exist for ownership-token + download-service URL retrieval,[4][5] but the prerequisite live Demux path is blocked here.                | See blocker reproduction below.                               | The MVP falls back to public manifest datasets and fixtures.                                                                                                                                                                                           |

## Commands run during validation

### Tooling and tests

```bash
npm run ci
npm run build
```

Outcome:

- `format:check`, `lint`, `typecheck`, and all tests passed.
- Current automated test count: 11 tests across 6 test files.

### Auth / account

```bash
node dist/index.js logout
node dist/index.js login
node dist/index.js me
```

Outcome:

- logout succeeded
- login succeeded live
- `me` returned a live identity (`source: live`)

### Library

```bash
node dist/index.js list
node dist/index.js list --json
```

Outcome:

- validated account returned 27 library entries
- 11 entries mapped to known public product IDs via the public product-service dataset

### Product metadata

```bash
node dist/index.js info 720 --json
node dist/index.js info 46 --json
```

Outcome:

- product `720` resolved to `Assassin's Creed® Unity`
- product `46` resolved to `Far Cry® 3`
- both commands returned manifest-hash and config-summary data when available from public datasets

### Manifest inspection

```bash
node dist/index.js manifest 720 --json
node dist/index.js manifest 46 --json
```

Outcome:

- both commands returned `status: parsed-public-fixture`
- product `720`: parsed summary included `chunkCount: 39`, `fileCount: 482`
- product `46`: parsed summary included manifest `version: 3`

## Blocker reproduction: live Demux

### TLS-level connectivity problem

```bash
openssl s_client -connect dmx.upc.ubisoft.com:443 -servername dmx.upc.ubisoft.com -brief </dev/null
```

Observed result:

- TLS setup terminated with `unexpected eof while reading`

### Node-level Demux problem

A direct `UbisoftDemux` connection attempt after patching the package's proto path resolution failed with `ECONNRESET` before a secure connection was established.

Interpretation:

- **Confirmed from source:** public Demux request shapes and ownership/download-service workflows exist.[1][4][5]
- **Experimentally observed in this repo:** the current `dmx.upc.ubisoft.com` endpoint was not reachable in a way the public client implementation could use from this environment, so live Demux-backed ownership and manifest URL retrieval remain blocked.

## Known limitations

1. The MVP currently relies on the public GraphQL library endpoint for `ubi list` because live Demux ownership initialization is blocked in this environment.[6][9]
2. Product-ID mapping is only as complete as the public `UplayManifests` datasets; some owned titles remain unmapped and therefore show `productId=unknown`.[14]
3. `ubi manifest` currently parses public raw fixtures when available instead of fetching live `.manifest/.metadata/.licenses` files from Ubisoft's download service.[5][11][17]
4. A local `.env` file is supported for operator convenience, but blank override variables can interfere with runtime defaults if not normalized; this repo now trims blank values before applying overrides.

## Validation interpretation

This repo currently demonstrates a **usable MVP** for:

- session login/logout
- account identity lookup
- live library listing via GraphQL
- source-backed product metadata lookup
- reproducible manifest inspection via public fixtures

It does **not** yet demonstrate full live Demux ownership/download-service integration, and the blocker is documented rather than hidden.
